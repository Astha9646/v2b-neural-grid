"""
Gymnasium environment over sequential ``grid_telemetry.csv`` rows.

Each step uses real telemetry transitions (s_t, s_{t+1}) while the agent
learns continuous grid-control actions that maximize the reward engine.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import gymnasium as gym
import numpy as np
import pandas as pd
from gymnasium import spaces

from backend.rl.reward import compute_reward
from backend.rl.rl_config import RLConfig, STATE_FEATURE_NAMES, default_config


def row_to_state(row: pd.Series | dict[str, Any], caps: dict[str, float]) -> np.ndarray:
    """Normalize telemetry row to [0, 1]^state_dim."""
    vec = np.zeros(len(STATE_FEATURE_NAMES), dtype=np.float32)
    if isinstance(row, pd.Series):
        row = row.to_dict()
    for i, name in enumerate(STATE_FEATURE_NAMES):
        cap = float(caps.get(name, 1.0)) or 1.0
        raw = row.get(name, 0.0)
        try:
            v = float(raw)
        except (TypeError, ValueError):
            v = 0.0
        if not np.isfinite(v):
            v = 0.0
        # Prefer pre-normalized columns when present
        if name == "grid_load_kw" and "normalized_load" in row:
            v = float(row.get("normalized_load", v / cap)) * cap
        if name == "soc_percent" and "normalized_soc" in row:
            v = float(row.get("normalized_soc", v / cap)) * cap
        if name == "grid_stress_index" and "normalized_stress" in row:
            v = float(row.get("normalized_stress", v / cap)) * cap
        vec[i] = np.clip(v / cap, 0.0, 1.0)
    return vec


class TelemetryGridEnv(gym.Env):
    """
    Sequential telemetry MDP for DDPG.

    Observation: normalized 9-dim grid telemetry vector.
    Action: 5-dim continuous control in [-1, 1].
    """

    metadata = {"render_modes": []}

    def __init__(
        self,
        df: pd.DataFrame | None = None,
        *,
        config: RLConfig | None = None,
        csv_path: Path | str | None = None,
        start_index: int = 0,
        max_steps: int | None = None,
    ) -> None:
        super().__init__()
        self.config = config or default_config()
        self.caps = self.config.norm_caps

        if df is None:
            path = Path(csv_path or self.config.telemetry_path)
            if not path.is_file():
                raise FileNotFoundError(f"Telemetry CSV not found: {path}")
            df = pd.read_csv(path).fillna(0)
        self._df = df.reset_index(drop=True)

        self._start_index = max(0, int(start_index))
        self._max_steps = max_steps or self.config.max_episode_steps
        self._cursor = self._start_index
        self._steps = 0
        self._episode_states: list[np.ndarray] = []
        self._episode_rewards: list[float] = []

        self.observation_space = spaces.Box(
            low=0.0,
            high=1.0,
            shape=(self.config.state_dim,),
            dtype=np.float32,
        )
        self.action_space = spaces.Box(
            low=-1.0,
            high=1.0,
            shape=(self.config.action_dim,),
            dtype=np.float32,
        )

    def _row_state(self, idx: int) -> np.ndarray:
        idx = int(np.clip(idx, 0, len(self._df) - 1))
        return row_to_state(self._df.iloc[idx], self.caps)

    def reset(
        self,
        *,
        seed: int | None = None,
        options: dict[str, Any] | None = None,
    ) -> tuple[np.ndarray, dict[str, Any]]:
        super().reset(seed=seed)
        if seed is not None:
            rng = np.random.default_rng(seed)
            max_start = max(0, len(self._df) - self._max_steps - 2)
            self._cursor = int(rng.integers(0, max_start + 1)) if max_start > 0 else 0
        else:
            self._cursor = self._start_index

        self._steps = 0
        self._episode_states = []
        self._episode_rewards = []
        state = self._row_state(self._cursor)
        self._episode_states.append(state.copy())
        return state, {"index": self._cursor}

    def step(
        self, action: np.ndarray
    ) -> tuple[np.ndarray, float, bool, bool, dict[str, Any]]:
        action = np.clip(np.asarray(action, dtype=np.float32).reshape(-1), -1.0, 1.0)
        state = self._row_state(self._cursor)

        next_idx = min(self._cursor + 1, len(self._df) - 1)
        next_state = self._row_state(next_idx)

        terminated = next_idx >= len(self._df) - 1
        truncated = self._steps + 1 >= self._max_steps
        done = terminated or truncated

        reward, breakdown = compute_reward(
            state, action, next_state, caps=self.caps, done=done
        )

        self._cursor = next_idx
        self._steps += 1
        self._episode_states.append(next_state.copy())
        self._episode_rewards.append(reward)

        info = {
            "index": self._cursor,
            "reward_breakdown": breakdown.to_dict(),
            "terminated": terminated,
            "truncated": truncated,
        }
        if done:
            from backend.rl.reward import episode_metrics

            info["episode_metrics"] = episode_metrics(
                self._episode_states, self._episode_rewards, self.caps
            )

        return next_state, reward, terminated, truncated, info

    @property
    def dataframe(self) -> pd.DataFrame:
        return self._df


def make_telemetry_env(
    config: RLConfig | None = None,
    *,
    train: bool = True,
) -> TelemetryGridEnv:
    """Factory: load CSV and optionally restrict to train split."""
    cfg = config or default_config()
    df = pd.read_csv(cfg.telemetry_path).fillna(0)
    n = len(df)
    split = int(n * cfg.train_split)
    if train:
        df = df.iloc[:split].reset_index(drop=True)
    else:
        df = df.iloc[split:].reset_index(drop=True)
    return TelemetryGridEnv(df, config=cfg)
