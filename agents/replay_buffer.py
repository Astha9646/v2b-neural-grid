"""
Experience replay buffer for DDPG V2B charging (arXiv:2502.18526).

Stores transitions (s, a, r, s', done) from the Gymnasium environment and
samples random mini-batches for off-policy critic/actor updates.

Uses ``collections.deque`` with ``maxlen`` for a fixed-size ring buffer and
NumPy for efficient batched tensors compatible with PyTorch training.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import NamedTuple

import numpy as np

# Defaults aligned with V2B site-level observation / multi-charger actions
DEFAULT_STATE_DIM = 23
DEFAULT_ACTION_DIM = 8
DEFAULT_CAPACITY = 100_000
DEFAULT_BATCH_SIZE = 64


class Transition(NamedTuple):
    """Single RL transition for continuous DDPG."""

    state: np.ndarray
    action: np.ndarray
    reward: float
    next_state: np.ndarray
    done: float


@dataclass
class ReplayBufferConfig:
    """Replay hyperparameters (DDPG off-policy learning)."""

    capacity: int = DEFAULT_CAPACITY
    batch_size: int = DEFAULT_BATCH_SIZE
    state_dim: int = DEFAULT_STATE_DIM
    action_dim: int = DEFAULT_ACTION_DIM
    # If True, sample with replacement when len(buffer) < batch_size
    allow_small_batch: bool = True


class ReplayBuffer:
    """
    Fixed-capacity experience replay for continuous-action DDPG.

    Parameters
    ----------
    capacity:
        Maximum number of transitions (oldest dropped when full).
    state_dim, action_dim:
        Fixed shapes for vectorized observations and actions.
    batch_size:
        Number of transitions returned by ``sample()``.
    seed:
        Optional RNG seed for reproducible sampling.

    Notes
    -----
    * States/actions are stored as float32 copies to avoid reference bugs.
    * ``done`` is stored as float32 (0.0 or 1.0) for PyTorch masking: Q ← r + (1-d)γQ'.
    """

    def __init__(
        self,
        capacity: int = DEFAULT_CAPACITY,
        state_dim: int = DEFAULT_STATE_DIM,
        action_dim: int = DEFAULT_ACTION_DIM,
        batch_size: int = DEFAULT_BATCH_SIZE,
        *,
        allow_small_batch: bool = True,
        seed: int | None = None,
    ) -> None:
        if capacity < 1:
            raise ValueError("capacity must be >= 1")
        if batch_size < 1:
            raise ValueError("batch_size must be >= 1")
        if state_dim < 1 or action_dim < 1:
            raise ValueError("state_dim and action_dim must be >= 1")

        self.capacity = capacity
        self.state_dim = state_dim
        self.action_dim = action_dim
        self.batch_size = batch_size
        self.allow_small_batch = allow_small_batch

        self._buffer: deque[Transition] = deque(maxlen=capacity)
        self._rng = np.random.default_rng(seed)

        # Pre-allocated batch arrays (reused each sample to reduce allocations)
        self._batch_states = np.empty((batch_size, state_dim), dtype=np.float32)
        self._batch_actions = np.empty((batch_size, action_dim), dtype=np.float32)
        self._batch_rewards = np.empty((batch_size, 1), dtype=np.float32)
        self._batch_next_states = np.empty((batch_size, state_dim), dtype=np.float32)
        self._batch_dones = np.empty((batch_size, 1), dtype=np.float32)

    def __len__(self) -> int:
        return len(self._buffer)

    @property
    def is_ready(self) -> bool:
        """True when at least ``batch_size`` transitions are available."""
        return len(self._buffer) >= self.batch_size

    def add(
        self,
        state: np.ndarray,
        action: np.ndarray,
        reward: float,
        next_state: np.ndarray,
        done: bool | float,
    ) -> None:
        """
        Append one experience (s, a, r, s', done).

        Parameters
        ----------
        state, next_state:
            Shape (state_dim,), normalized [0, 1] from ``V2BChargingEnv``.
        action:
            Shape (action_dim,), typically tanh ∈ [-1, 1] per charger.
        reward:
            Scalar step reward.
        done:
            Episode termination flag (terminated or truncated).
        """
        transition = Transition(
            state=self._validate_vector(state, self.state_dim, "state"),
            action=self._validate_vector(action, self.action_dim, "action"),
            reward=float(reward),
            next_state=self._validate_vector(next_state, self.state_dim, "next_state"),
            done=float(done),
        )
        self._buffer.append(transition)

    def add_batch(
        self,
        states: np.ndarray,
        actions: np.ndarray,
        rewards: np.ndarray,
        next_states: np.ndarray,
        dones: np.ndarray,
    ) -> None:
        """
        Add multiple transitions (e.g. from parallel env rollouts).

        Arrays shapes: (B, state_dim), (B, action_dim), (B,), (B, state_dim), (B,).
        """
        states = np.asarray(states, dtype=np.float32)
        actions = np.asarray(actions, dtype=np.float32)
        rewards = np.asarray(rewards, dtype=np.float32).reshape(-1)
        next_states = np.asarray(next_states, dtype=np.float32)
        dones = np.asarray(dones, dtype=np.float32).reshape(-1)

        b = states.shape[0]
        if b == 0:
            return
        for i in range(b):
            self.add(states[i], actions[i], float(rewards[i]), next_states[i], float(dones[i]))

    def sample(
        self,
        batch_size: int | None = None,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        """
        Draw a random mini-batch for DDPG updates.

        Returns
        -------
        states : (B, state_dim) float32
        actions : (B, action_dim) float32
        rewards : (B, 1) float32
        next_states : (B, state_dim) float32
        dones : (B, 1) float32

        Ready for ``torch.as_tensor(..., device=device)`` in the critic loss.
        """
        n = len(self._buffer)
        if n == 0:
            raise RuntimeError("Cannot sample from an empty replay buffer.")

        bs = batch_size or self.batch_size
        if n < bs and not self.allow_small_batch:
            raise RuntimeError(
                f"Buffer has {n} transitions but batch_size is {bs}. "
                "Wait for more data or enable allow_small_batch."
            )
        bs = min(bs, n)

        # Random indices without replacement when possible
        replace = n < bs
        indices = self._rng.choice(n, size=bs, replace=replace)

        # Fill pre-allocated slices (views returned to caller)
        for j, idx in enumerate(indices):
            t = self._buffer[idx]
            self._batch_states[j] = t.state
            self._batch_actions[j] = t.action
            self._batch_rewards[j, 0] = t.reward
            self._batch_next_states[j] = t.next_state
            self._batch_dones[j, 0] = t.done

        return (
            self._batch_states[:bs].copy(),
            self._batch_actions[:bs].copy(),
            self._batch_rewards[:bs].copy(),
            self._batch_next_states[:bs].copy(),
            self._batch_dones[:bs].copy(),
        )

    def sample_torch_batch(
        self,
        batch_size: int | None = None,
        *,
        device: str = "cpu",
    ) -> tuple:
        """
        Sample and convert directly to PyTorch tensors.

        Returns (states, actions, rewards, next_states, dones) as ``torch.Tensor``.
        """
        import torch

        states, actions, rewards, next_states, dones = self.sample(batch_size)
        return (
            torch.as_tensor(states, device=device),
            torch.as_tensor(actions, device=device),
            torch.as_tensor(rewards, device=device),
            torch.as_tensor(next_states, device=device),
            torch.as_tensor(dones, device=device),
        )

    def clear(self) -> None:
        """Remove all stored transitions."""
        self._buffer.clear()

    @staticmethod
    def _validate_vector(arr: np.ndarray, dim: int, name: str) -> np.ndarray:
        x = np.asarray(arr, dtype=np.float32).reshape(-1)
        if x.shape[0] != dim:
            raise ValueError(f"{name} must have shape ({dim},), got {x.shape}")
        return x.copy()

    @classmethod
    def from_gym_env(
        cls,
        env: object,
        *,
        capacity: int = DEFAULT_CAPACITY,
        batch_size: int = DEFAULT_BATCH_SIZE,
        seed: int | None = None,
    ) -> ReplayBuffer:
        """Build buffer with dimensions from Gymnasium Box spaces."""
        state_dim = int(env.observation_space.shape[0])  # type: ignore[attr-defined]
        action_dim = int(env.action_space.shape[0])  # type: ignore[attr-defined]
        return cls(
            capacity=capacity,
            state_dim=state_dim,
            action_dim=action_dim,
            batch_size=batch_size,
            seed=seed,
        )


def main() -> None:
    """Smoke test: add transitions and sample a batch."""
    buf = ReplayBuffer(capacity=1000, state_dim=23, action_dim=6, batch_size=32, seed=0)

    for i in range(100):
        s = np.random.rand(23).astype(np.float32)
        a = np.random.uniform(-1, 1, size=6).astype(np.float32)
        ns = np.random.rand(23).astype(np.float32)
        buf.add(s, a, reward=float(i) * 0.01, next_state=ns, done=i == 99)

    print("len:", len(buf), "ready:", buf.is_ready)
    states, actions, rewards, next_states, dones = buf.sample()
    print("states", states.shape, states.dtype)
    print("actions", actions.shape)
    print("rewards", rewards.shape, "range", rewards.min(), rewards.max())
    print("dones", dones.shape, "sum", dones.sum())

    if __import__("importlib").util.find_spec("torch"):
        tensors = buf.sample_torch_batch(device="cpu")
        print("torch batch:", [t.shape for t in tensors])


if __name__ == "__main__":
    main()
