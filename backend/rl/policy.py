"""
Load trained telemetry DDPG actor for inference / grid intelligence.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import numpy as np
import torch

from backend.rl.env import row_to_state
from backend.rl.networks import Actor, NetworkConfig
from backend.rl.rl_config import ACTION_NAMES, RLConfig, STATE_FEATURE_NAMES, default_config

logger = logging.getLogger(__name__)

_policy_cache: "TelemetryPolicy | None" = None


class TelemetryPolicy:
    """Deterministic policy from ``checkpoints/ddpg_actor.pth``."""

    def __init__(self, config: RLConfig | None = None) -> None:
        self.config = config or default_config()
        self.device = torch.device("cpu")
        self._loaded = False
        net_cfg = NetworkConfig(
            state_dim=self.config.state_dim,
            action_dim=self.config.action_dim,
            hidden_dims=self.config.hidden_dims,
        )
        self.actor = Actor(net_cfg)
        self._try_load()

    def _try_load(self) -> None:
        path = self.config.actor_checkpoint
        if not path.is_file():
            logger.warning("DDPG actor checkpoint missing: %s", path)
            return
        try:
            state_dict = torch.load(path, map_location="cpu", weights_only=True)
            self.actor.load_state_dict(state_dict)
            self.actor.eval()
            self._loaded = True
            logger.info("Telemetry DDPG policy loaded from %s", path)
        except Exception as exc:
            logger.error("Failed to load DDPG actor: %s", exc)

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    def state_from_row(self, row: dict[str, Any]) -> np.ndarray:
        return row_to_state(row, self.config.norm_caps)

    def predict(self, row: dict[str, Any]) -> dict[str, Any]:
        """Return action dict and recommendations from telemetry row."""
        state = self.state_from_row(row)
        action = self.act(state)
        return self._action_to_recommendations(row, action)

    def act(self, state: np.ndarray) -> np.ndarray:
        if not self._loaded:
            return np.zeros(self.config.action_dim, dtype=np.float32)
        s = torch.as_tensor(state, dtype=torch.float32).unsqueeze(0)
        with torch.no_grad():
            a = self.actor(s).numpy().flatten()
        return np.clip(a, -1.0, 1.0).astype(np.float32)

    def _action_to_recommendations(
        self, row: dict[str, Any], action: np.ndarray
    ) -> dict[str, Any]:
        named = {ACTION_NAMES[i]: float(action[i]) for i in range(len(ACTION_NAMES))}
        load = float(row.get("grid_load_kw", 0))
        renewable = float(row.get("renewable_ratio", 0))
        stress = float(row.get("grid_stress_index", 0))

        charging_adj = named["charging_rate_adjustment"]
        if charging_adj > 0.3:
            charging_strategy = "increase_charging_setpoints"
        elif charging_adj < -0.3:
            charging_strategy = "reduce_charging_load"
        else:
            charging_strategy = "maintain_charging_profile"

        renewable_strategy = (
            "maximize_solar_dispatch"
            if named["renewable_allocation"] > 0.2 or renewable > 0.35
            else "grid_blend_mode"
        )

        peak_shaving = (
            f"Apply peak shaving factor {named['peak_shaving_factor']:.2f} — "
            f"target reduction ~{max(5, int(load * 0.08 * abs(named['peak_shaving_factor'])))} kW"
        )
        battery_protection = (
            f"Battery protection strength {named['battery_protection_strength']:.2f} — "
            "limit deep cycles and fast-charge ramp"
        )
        grid_balancing = (
            f"Load shift factor {named['load_shift_factor']:.2f} — "
            f"rebalance {max(1, int(abs(named['load_shift_factor']) * 20))} kW across fleet"
        )

        confidence = float(np.clip(0.55 + 0.35 * (1.0 - stress), 0.5, 0.98))

        return {
            "actions": named,
            "optimization_action": charging_strategy,
            "charging_strategy": charging_strategy,
            "renewable_strategy": renewable_strategy,
            "peak_shaving_action": peak_shaving,
            "battery_protection_action": battery_protection,
            "grid_balancing_action": grid_balancing,
            "thermal_protection_action": "thermal_guard_from_policy",
            "ai_recommendation": (
                f"DDPG policy: {charging_strategy.replace('_', ' ')} with "
                f"{renewable_strategy.replace('_', ' ')} (stress {stress:.0%})."
            ),
            "ai_reasoning": (
                f"Actor outputs: charging_adj={charging_adj:.2f}, renewable={named['renewable_allocation']:.2f}, "
                f"peak={named['peak_shaving_factor']:.2f}."
            ),
            "confidence_score": confidence,
            "risk_level": (
                "critical" if stress > 0.75 else "high" if stress > 0.55 else "medium" if stress > 0.35 else "low"
            ),
        }


def get_telemetry_policy(config: RLConfig | None = None) -> TelemetryPolicy:
    global _policy_cache
    if _policy_cache is None:
        _policy_cache = TelemetryPolicy(config)
    return _policy_cache
