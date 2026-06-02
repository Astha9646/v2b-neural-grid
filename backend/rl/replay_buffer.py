"""
Experience replay buffer for telemetry DDPG.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class Transition:
    state: np.ndarray
    action: np.ndarray
    reward: float
    next_state: np.ndarray
    done: bool


class ReplayBuffer:
    """Fixed-capacity ring buffer for off-policy DDPG."""

    def __init__(
        self,
        capacity: int,
        state_dim: int,
        action_dim: int,
        *,
        batch_size: int = 128,
        seed: int | None = None,
    ) -> None:
        self.capacity = int(capacity)
        self.state_dim = state_dim
        self.action_dim = action_dim
        self.batch_size = batch_size
        self._rng = np.random.default_rng(seed)

        self._states = np.zeros((capacity, state_dim), dtype=np.float32)
        self._actions = np.zeros((capacity, action_dim), dtype=np.float32)
        self._rewards = np.zeros((capacity, 1), dtype=np.float32)
        self._next_states = np.zeros((capacity, state_dim), dtype=np.float32)
        self._dones = np.zeros((capacity, 1), dtype=np.float32)

        self._ptr = 0
        self._size = 0

    def __len__(self) -> int:
        return self._size

    @property
    def is_ready(self) -> bool:
        return self._size >= self.batch_size

    def add(
        self,
        state: np.ndarray,
        action: np.ndarray,
        reward: float,
        next_state: np.ndarray,
        done: bool,
    ) -> None:
        i = self._ptr
        self._states[i] = np.asarray(state, dtype=np.float32).reshape(-1)[: self.state_dim]
        self._actions[i] = np.asarray(action, dtype=np.float32).reshape(-1)[: self.action_dim]
        self._rewards[i, 0] = float(reward)
        self._next_states[i] = np.asarray(next_state, dtype=np.float32).reshape(-1)[
            : self.state_dim
        ]
        self._dones[i, 0] = float(done)

        self._ptr = (self._ptr + 1) % self.capacity
        self._size = min(self._size + 1, self.capacity)

    def sample(self, batch_size: int | None = None) -> tuple[np.ndarray, ...]:
        bs = batch_size or self.batch_size
        if self._size < bs:
            raise RuntimeError(f"Replay buffer has {self._size} samples, need {bs}")
        idx = self._rng.integers(0, self._size, size=bs)
        return (
            self._states[idx],
            self._actions[idx],
            self._rewards[idx],
            self._next_states[idx],
            self._dones[idx],
        )
