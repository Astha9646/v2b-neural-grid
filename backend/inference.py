"""
Production V2B DDPG inference engine for real-time smart charging APIs.

Pipeline:
  preprocess_state  → validate / normalize 23-dim StateBuilder vectors
  predict_action    → deterministic Actor forward (torch.inference_mode)
  postprocess_action → ActionMask safety + kW scaling / clipping

Integrates: ``agents.actor``, ``rl_env.action_mask``, ``rl_env.state_builder``.
"""

from __future__ import annotations

import json
import logging
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import torch

from agents.actor import Actor
from agents.ddpg_agent import DDPGAgent, DDPGConfig
from rl_env.action_mask import (
    ActionMask,
    V2BMaskContext,
    scale_tanh_to_power,
)
from rl_env.ev_env import V2BEnvConfig, make_v2b_env
from rl_env.state_builder import STATE_DIM, STATE_FEATURE_NAMES, StateBuilder

from backend.config import Settings, settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Result container
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class InferenceResult:
    """Outputs from a full inference pass."""

    actions_tanh: np.ndarray  # safe normalized actions in [-1, 1]
    actions_kw: np.ndarray | None  # physical charger power after masking
    raw_actions_tanh: np.ndarray  # actor output before domain masks


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _clip_unit(values: np.ndarray) -> np.ndarray:
    """Clip state features into [0, 1] for DDPG stability."""
    return np.clip(np.asarray(values, dtype=np.float64), 0.0, 1.0).astype(np.float32)


def _clip_tanh(actions: np.ndarray) -> np.ndarray:
    """Clip continuous DDPG actions to the actor output range."""
    return np.clip(np.asarray(actions, dtype=np.float32), -1.0, 1.0)


def _kw_to_tanh(
    power_kw: np.ndarray,
    c_min: np.ndarray,
    c_max: np.ndarray,
) -> np.ndarray:
    """Inverse of ``scale_tanh_to_power`` for API-normalized action reporting."""
    p = np.asarray(power_kw, dtype=np.float64)
    lo = np.asarray(c_min, dtype=np.float64)
    hi = np.asarray(c_max, dtype=np.float64)
    span = np.maximum(hi - lo, 1e-8)
    return np.clip(2.0 * (p - lo) / span - 1.0, -1.0, 1.0).astype(np.float32)


def _resolve_device(device_cfg: str) -> str:
    if device_cfg == "auto":
        return "cuda" if torch.cuda.is_available() else "cpu"
    return device_cfg


# ---------------------------------------------------------------------------
# InferenceEngine
# ---------------------------------------------------------------------------


class InferenceEngine:
    """
    Thread-safe V2B DDPG inference for heterogeneous EV chargers.

    Loads and caches the trained Actor, runs deterministic forward passes,
    and applies ``ActionMask`` so charging / V2B discharge stays within
    physical and building constraints.
    """

    def __init__(self, cfg: Settings | None = None) -> None:
        self._cfg = cfg or settings
        self._lock = threading.RLock()
        self._actor: Actor | None = None
        self._agent: DDPGAgent | None = None
        self._env: Any | None = None
        self._action_mask = ActionMask()
        self._state_builder: StateBuilder | None = None
        self._device: str = "cpu"
        self._checkpoint_dir: Path | None = None
        self._loaded = False

    # --- public properties -------------------------------------------------

    @property
    def is_loaded(self) -> bool:
        return self._loaded and self._actor is not None

    @property
    def device(self) -> str:
        return self._device

    @property
    def state_dim(self) -> int:
        if self._actor is not None:
            return int(self._actor.state_dim)
        return STATE_DIM

    @property
    def action_dim(self) -> int:
        if self._actor is not None:
            return int(self._actor.action_dim)
        return int(self._cfg.num_chargers)

    @property
    def checkpoint_dir(self) -> Path | None:
        return self._checkpoint_dir

    @property
    def feature_names(self) -> tuple[str, ...]:
        return STATE_FEATURE_NAMES

    # --- model lifecycle ---------------------------------------------------

    def load_model(
        self,
        checkpoint_dir: Path | str | None = None,
        *,
        force_reload: bool = False,
        cfg: Settings | None = None,
    ) -> None:
        """
        Load trained Actor weights from checkpoint (cached until ``unload``).

        Uses ``meta.pt`` for architecture dims and ``actor.pt`` for weights.
        Falls back to a lightweight Gym env only to recover action/state spaces
        when metadata is missing.
        """
        cfg = cfg or self._cfg
        ckpt = (
            Path(checkpoint_dir)
            if checkpoint_dir is not None
            else cfg.checkpoint_dir_resolved
        )

        with self._lock:
            if self._loaded and not force_reload:
                if self._checkpoint_dir == ckpt:
                    return
                self.unload()

            actor_path = ckpt / "actor.pt"
            if not actor_path.is_file():
                raise FileNotFoundError(f"Missing actor.pt in {ckpt}")

            self._device = _resolve_device(cfg.device)
            torch_device = torch.device(self._device)

            state_dim = STATE_DIM
            action_dim = int(cfg.num_chargers)
            hidden_dims = (96, 96)

            meta: dict[str, Any] = {}
            meta_path = ckpt / "meta.pt"
            if meta_path.is_file():
                meta = torch.load(meta_path, map_location="cpu", weights_only=True)
                saved = meta.get("config", {})
                state_dim = int(saved.get("state_dim", state_dim))
                action_dim = int(saved.get("action_dim", action_dim))
                if "hidden_dims" in saved:
                    hidden_dims = tuple(saved["hidden_dims"])
                elif "hidden_dim" in saved:
                    h = int(saved["hidden_dim"])
                    hidden_dims = (h, h)

            # Optional env for per-charger c_min / c_max buffers on the Actor
            env_cfg = V2BEnvConfig(
                num_chargers=action_dim,
                episode_slots=cfg.episode_slots,
                dataset_path=str(cfg.legacy_dataset_file),
            )
            self._env = make_v2b_env(env_cfg)

            ddpg_cfg = DDPGConfig(
                state_dim=state_dim,
                action_dim=action_dim,
                hidden_dims=hidden_dims,
                device=self._device,
            )
            self._agent = DDPGAgent.from_gym_env(
                self._env,
                config=ddpg_cfg,
                device=self._device,
            )
            self._agent.load_models(ckpt, load_optimizers=False)
            self._agent.set_eval_mode()

            self._actor = self._agent.actor
            self._actor.to(torch_device)
            self._actor.eval()

            self._checkpoint_dir = ckpt
            self._loaded = True

            logger.info(
                "InferenceEngine loaded %s on %s (state=%d, action=%d)",
                ckpt,
                self._device,
                self.state_dim,
                self.action_dim,
            )

    def unload(self) -> None:
        """Release cached model, env, and optional StateBuilder."""
        with self._lock:
            if self._env is not None:
                try:
                    self._env.close()
                except Exception:
                    pass
            self._env = None
            self._agent = None
            self._actor = None
            self._state_builder = None
            self._checkpoint_dir = None
            self._loaded = False

    def _get_state_builder(self) -> StateBuilder:
        """Lazy-load StateBuilder for session-index API inputs."""
        if self._state_builder is None:
            self._state_builder = StateBuilder(dataset_path=str(self._cfg.dataset_path))
        return self._state_builder

    # --- preprocessing -----------------------------------------------------

    def preprocess_state(
        self,
        *,
        state: list[float] | np.ndarray | None = None,
        state_features: dict[str, float] | None = None,
        session_index: int | None = None,
        elapsed_hours: float = 0.0,
    ) -> np.ndarray:
        """
        Validate and normalize the smart-grid state vector for the Actor.

        Accepts:
          - raw ``state`` list/array (length ``state_dim``, values in [0, 1])
          - named ``state_features`` dict (``StateBuilder`` feature order)
          - ``session_index`` into the processed dataset via ``StateBuilder``

        Returns float32 vector of shape ``(state_dim,)``.
        """
        if session_index is not None:
            vec = self._get_state_builder().build_state(
                int(session_index),
                elapsed_hours=float(elapsed_hours),
            )
            return self._validate_state(vec)

        if state is not None:
            vec = np.asarray(state, dtype=np.float32).reshape(-1)
            return self._validate_state(vec)

        if state_features is not None:
            vec = np.array(
                [float(state_features.get(name, 0.5)) for name in STATE_FEATURE_NAMES],
                dtype=np.float32,
            )
            return self._validate_state(vec)

        raise ValueError("Provide 'state', 'state_features', or 'session_index'")

    def _validate_state(self, vec: np.ndarray) -> np.ndarray:
        if vec.shape[0] != self.state_dim:
            raise ValueError(
                f"State dimension mismatch: expected {self.state_dim}, got {vec.shape[0]}"
            )
        if not np.all(np.isfinite(vec)):
            raise ValueError("State vector contains NaN or Inf")
        return _clip_unit(vec).astype(np.float32)

    # --- core inference ----------------------------------------------------

    @torch.inference_mode()
    def predict_action(self, state: np.ndarray) -> np.ndarray:
        """
        Deterministic DDPG Actor forward pass (no exploration noise).

        Uses ``torch.inference_mode`` and ``Actor.eval()`` for production inference.
        """
        if not self.is_loaded or self._actor is None:
            raise RuntimeError("Model not loaded; call load_model() first")

        state = np.asarray(state, dtype=np.float32).reshape(-1)
        if state.shape[0] != self.state_dim:
            raise ValueError(
                f"State dimension mismatch: expected {self.state_dim}, got {state.shape[0]}"
            )

        with self._lock:
            dev = torch.device(self._device)
            st = torch.as_tensor(state, dtype=torch.float32, device=dev)
            if st.dim() == 1:
                st = st.unsqueeze(0)

            action = self._actor(st)
            action = torch.clamp(action, -1.0, 1.0)
            if action.dim() > 1:
                action = action.squeeze(0)

            return action.cpu().numpy().astype(np.float32).reshape(-1)

    # --- postprocessing ----------------------------------------------------

    def postprocess_action(
        self,
        action_tanh: np.ndarray,
        *,
        mask_context: dict[str, Any] | None = None,
        apply_mask: bool | None = None,
        return_power_kw: bool = True,
    ) -> InferenceResult:
        """
        Apply safety masks and optional kW scaling for heterogeneous chargers.

        When masking is enabled, uses ``ActionMask.apply_masks_tanh`` so domain
        rules operate in physical power space, then reports consistent tanh/kW pairs.
        """
        raw = _clip_tanh(action_tanh).reshape(-1)
        use_mask = (
            apply_mask if apply_mask is not None else self._cfg.apply_action_mask
        )

        c_min, c_max = self._charger_limits(mask_context)

        actions_kw: np.ndarray | None = None
        safe_tanh = raw.copy()

        if use_mask and mask_context is not None:
            ctx = self._build_mask_context(mask_context)
            actions_kw = self._action_mask.apply_masks_tanh(
                raw.astype(np.float64),
                ctx,
            ).astype(np.float32)
            safe_tanh = _kw_to_tanh(actions_kw, ctx.c_min, ctx.c_max)
        elif return_power_kw:
            actions_kw = scale_tanh_to_power(
                raw.astype(np.float64),
                c_min.astype(np.float64),
                c_max.astype(np.float64),
            ).astype(np.float32)
            actions_kw = np.clip(actions_kw, c_min, c_max).astype(np.float32)

        return InferenceResult(
            actions_tanh=safe_tanh,
            actions_kw=actions_kw if return_power_kw else None,
            raw_actions_tanh=raw,
        )

    def infer(
        self,
        state: np.ndarray,
        *,
        explore: bool = False,
        return_power_kw: bool = True,
        mask_context: dict[str, Any] | None = None,
        apply_mask: bool | None = None,
    ) -> InferenceResult:
        """
        Full real-time pipeline: preprocess is assumed done; predict + postprocess.

        ``explore`` is ignored (deterministic production default); kept for API parity.
        """
        if explore:
            logger.warning("explore=True ignored in production InferenceEngine")

        state = self._validate_state(np.asarray(state, dtype=np.float32))
        raw_action = self.predict_action(state)
        return self.postprocess_action(
            raw_action,
            mask_context=mask_context,
            apply_mask=apply_mask,
            return_power_kw=return_power_kw,
        )

    # --- mask / limit helpers ----------------------------------------------

    def _charger_limits(
        self,
        mask_context: dict[str, Any] | None,
    ) -> tuple[np.ndarray, np.ndarray]:
        n = self.action_dim
        if mask_context is not None:
            if "c_min" in mask_context:
                c_min = np.asarray(mask_context["c_min"], dtype=np.float32).reshape(-1)
            else:
                c_min = np.full(n, -50.0, dtype=np.float32)
            if "c_max" in mask_context:
                c_max = np.asarray(mask_context["c_max"], dtype=np.float32).reshape(-1)
            else:
                c_max = np.full(n, 7.2, dtype=np.float32)
            return c_min, c_max

        if self._actor is not None and hasattr(self._actor, "c_min_kw"):
            c_min = self._actor.c_min_kw.detach().cpu().numpy().astype(np.float32)
            c_max = self._actor.c_max_kw.detach().cpu().numpy().astype(np.float32)
            return c_min.reshape(-1), c_max.reshape(-1)

        return np.full(n, -50.0, dtype=np.float32), np.full(n, 7.2, dtype=np.float32)

    def _build_mask_context(self, data: dict[str, Any]) -> V2BMaskContext:
        n = self.action_dim

        def _arr(key: str, default: float) -> np.ndarray:
            if key in data:
                return np.asarray(data[key], dtype=np.float64).reshape(-1)
            return np.full(n, default, dtype=np.float64)

        connected = data.get("connected")
        if connected is None:
            tau = _arr("tau_remaining_slots", 0.0)
            connected = tau > 0
        else:
            connected = np.asarray(connected, dtype=bool).reshape(-1)

        uni = np.asarray(data.get("uni_idx", []), dtype=int)
        bi = np.asarray(data.get("bi_idx", list(range(n))), dtype=int)

        return V2BMaskContext(
            kwh_required=_arr("kwh_required", 0.0),
            tau_remaining=_arr("tau_remaining_slots", 0.0),
            c_max=_arr("c_max", 7.2),
            c_min=_arr("c_min", 0.0),
            connected=connected,
            uni_idx=uni,
            bi_idx=bi,
            building_power=float(data.get("building_power_kw", 80.0)),
            estimated_peak_power=float(data.get("estimated_peak_power_kw", 150.0)),
            soc_current=_arr("soc_current", 0.5),
            soc_target=_arr("soc_target", 0.9),
            soc_min=_arr("soc_min", 0.1),
            battery_capacity_kwh=_arr("battery_capacity_kwh", 60.0),
            delta_hours=float(data.get("delta_hours", 1.0)),
        )

    # --- evaluation artifacts (unchanged service helper) -------------------

    def get_metrics(self, cfg: Settings | None = None) -> dict[str, Any]:
        """Load evaluation artifacts from disk (produced by ``evaluate.py``)."""
        cfg = cfg or self._cfg
        result: dict[str, Any] = {"available": False}

        report_path = Path(cfg.eval_report_path)
        if report_path.is_file():
            with report_path.open(encoding="utf-8") as f:
                result["report"] = json.load(f)
            result["available"] = True

        csv_path = Path(cfg.eval_metrics_csv)
        if csv_path.is_file():
            df = pd.read_csv(csv_path)
            summary: dict[str, Any] = {}
            for policy in df["policy"].unique():
                sub = df[df["policy"] == policy]
                summary[policy] = {
                    "mean_reward": float(sub["episode_reward"].mean()),
                    "mean_cost_usd": float(sub["electricity_cost_usd"].mean()),
                    "mean_peak_kw": float(sub["peak_demand_kw"].mean()),
                    "mean_renewable_util": float(sub["renewable_utilization"].mean()),
                    "mean_charging_satisfaction": float(sub["charging_satisfaction"].mean()),
                    "mean_battery_degradation": float(sub["battery_degradation"].mean()),
                    "n_episodes": int(len(sub)),
                }
            result["episode_summary"] = summary
            result["available"] = True

        if not result["available"]:
            result["message"] = "No evaluation files found. Run: python evaluate.py"

        return result


# ---------------------------------------------------------------------------
# FastAPI facade (backward compatible with backend.main)
# ---------------------------------------------------------------------------


class ModelService:
    """
    Thin wrapper around :class:`InferenceEngine` for FastAPI lifespan hooks.

    Exposes the same surface as before: ``load``, ``predict``, ``is_loaded``.
    Falls back to heuristic actions when the DDPG checkpoint is unavailable.
    """

    def __init__(self) -> None:
        self._engine = InferenceEngine()
        self._fallback_mode = False
        self._fallback_reason: str | None = None

    @property
    def is_loaded(self) -> bool:
        return self._engine.is_loaded

    @property
    def using_fallback(self) -> bool:
        return self._fallback_mode or not self._engine.is_loaded

    @property
    def fallback_reason(self) -> str | None:
        return self._fallback_reason

    def mark_fallback(self, reason: str) -> None:
        self._fallback_mode = True
        self._fallback_reason = reason
        logger.warning("Inference fallback enabled: %s", reason)

    def clear_fallback(self) -> None:
        self._fallback_mode = False
        self._fallback_reason = None

    @property
    def checkpoint_dir(self) -> Path | None:
        return self._engine.checkpoint_dir

    @property
    def device(self) -> str:
        return self._engine.device

    @property
    def state_dim(self) -> int:
        return self._engine.state_dim

    @property
    def action_dim(self) -> int:
        return self._engine.action_dim

    def load(self, cfg: Settings | None = None) -> None:
        cfg = cfg or settings
        self._engine.load_model(cfg=cfg)
        self.clear_fallback()

    @staticmethod
    def _heuristic_actions(state_vec: np.ndarray, action_dim: int) -> tuple[np.ndarray, np.ndarray]:
        """
        Safe neutral fallback when DDPG weights are unavailable.

        Uses mid-range tanh (0) with conservative kW setpoints derived from state
        stress indicators when present.
        """
        n = action_dim
        actions_tanh = np.zeros(n, dtype=np.float32)
        # Mild load-shaving bias when grid stress feature (index 4 in many builders) is high
        if state_vec.size > 4:
            stress = float(np.clip(state_vec[4], 0.0, 1.0))
            if stress > 0.55:
                actions_tanh = np.full(n, -0.15, dtype=np.float32)
        c_max = np.full(n, 7.2, dtype=np.float32)
        c_min = np.full(n, -50.0, dtype=np.float32)
        actions_kw = scale_tanh_to_power(
            actions_tanh.astype(np.float64),
            c_min.astype(np.float64),
            c_max.astype(np.float64),
        ).astype(np.float32)
        return actions_tanh, actions_kw

    def state_vector_from_request(
        self,
        state: list[float] | None,
        state_features: dict[str, float] | None = None,
        *,
        session_index: int | None = None,
        elapsed_hours: float = 0.0,
    ) -> np.ndarray:
        return self._engine.preprocess_state(
            state=state,
            state_features=state_features,
            session_index=session_index,
            elapsed_hours=elapsed_hours,
        )

    def predict(
        self,
        state_vec: np.ndarray,
        *,
        explore: bool = False,
        return_power_kw: bool = True,
        mask_context: dict[str, Any] | None = None,
        apply_mask: bool | None = None,
    ) -> tuple[np.ndarray, np.ndarray | None, bool]:
        """
        Run DDPG inference or heuristic fallback.

        Returns (actions_tanh, actions_kw, used_fallback).
        """
        if self.is_loaded and not self._fallback_mode:
            try:
                result = self._engine.infer(
                    state_vec,
                    explore=explore,
                    return_power_kw=return_power_kw,
                    mask_context=mask_context,
                    apply_mask=apply_mask,
                )
                return result.actions_tanh, result.actions_kw, False
            except Exception as exc:
                logger.warning("DDPG predict failed — using heuristic fallback: %s", exc)
                self.mark_fallback(str(exc))

        actions_tanh, actions_kw = self._heuristic_actions(state_vec, self.action_dim)
        if not return_power_kw:
            actions_kw = None
        return actions_tanh, actions_kw, True

    def get_metrics(self, cfg: Settings | None = None) -> dict[str, Any]:
        return self._engine.get_metrics(cfg)

    def shutdown(self) -> None:
        self._engine.unload()
        self.clear_fallback()


# Global cached instance (loaded on app startup)
model_service = ModelService()
