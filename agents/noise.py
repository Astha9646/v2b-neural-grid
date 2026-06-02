"""
Ornstein–Uhlenbeck (OU) exploration noise for DDPG V2B charging (arXiv:2502.18526).

DDPG uses correlated noise on continuous actions so exploration persists across
time steps — smoother than i.i.d. Gaussian noise for charging power trajectories
over heterogeneous chargers.

Discrete-time update (Lillicrap et al., 2015):

    x_{t+1} = x_t + θ (μ - x_t) Δt + σ √(Δt) 𝒩(0, I)

``sample()`` returns x_t; add to Actor tanh output and clip to [-1, 1] per charger.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

DEFAULT_ACTION_DIM = 8

# Standard DDPG hyperparameters (action scale ∈ [-1, 1])
DEFAULT_MU = 0.0
DEFAULT_THETA = 0.15
DEFAULT_SIGMA = 0.2
DEFAULT_DT = 0.01


@dataclass
class OUNoiseConfig:
    """OU process parameters."""

    action_dim: int = DEFAULT_ACTION_DIM
    mu: float = DEFAULT_MU
    theta: float = DEFAULT_THETA
    sigma: float = DEFAULT_SIGMA
    dt: float = DEFAULT_DT
    max_noise: float | None = 1.0
    seed: int | None = None


class OUNoise:
    """
    Temporally correlated exploration noise for continuous DDPG actions.

    Parameters
    ----------
    action_dim:
        Number of chargers (one OU component per action dimension).
    mu:
        Long-run mean μ (typically 0).
    theta:
        Mean-reversion rate θ (scalar or length ``action_dim``).
    sigma:
        Volatility σ (scalar or length ``action_dim``).
    dt:
        Timestep Δt between RL steps.
    max_noise:
        Clip each component to [-max_noise, max_noise] (default 1.0 for tanh).
    seed:
        NumPy RNG seed.

    Usage
    -----
    noise.reset()  # each episode
    action = actor.act(state) + noise.sample()
    action = np.clip(action, -1.0, 1.0)
    """

    def __init__(
        self,
        action_dim: int = DEFAULT_ACTION_DIM,
        mu: float = DEFAULT_MU,
        theta: float | np.ndarray = DEFAULT_THETA,
        sigma: float | np.ndarray = DEFAULT_SIGMA,
        dt: float = DEFAULT_DT,
        *,
        max_noise: float | None = 1.0,
        seed: int | None = None,
    ) -> None:
        if action_dim < 1:
            raise ValueError("action_dim must be >= 1")

        self.action_dim = action_dim
        self.mu = float(mu)
        self.dt = float(dt)
        self.max_noise = max_noise

        self._theta = self._as_dim_vector(theta, "theta")
        self._sigma = self._as_dim_vector(sigma, "sigma")
        self._mu_vec = np.full(action_dim, self.mu, dtype=np.float64)

        self._rng = np.random.default_rng(seed)
        self._state = self._mu_vec.copy()
        self._sigma_initial = self._sigma.copy()

    def _as_dim_vector(self, value: float | np.ndarray, name: str) -> np.ndarray:
        arr = np.asarray(value, dtype=np.float64).reshape(-1)
        if arr.size == 1:
            return np.full(self.action_dim, arr[0], dtype=np.float64)
        if arr.size != self.action_dim:
            raise ValueError(f"{name} length {arr.size} must be 1 or action_dim {self.action_dim}")
        return arr.copy()

    def reset(self, *, random_start: bool = False) -> np.ndarray:
        """
        Reset OU state to μ (start of episode).

        Parameters
        ----------
        random_start:
            If True, initialize near μ with small Gaussian spread for diversity.

        Returns
        -------
        np.ndarray
            Current state after reset, shape (action_dim,).
        """
        self._state = self._mu_vec.copy()
        if random_start:
            self._state += self._rng.normal(0.0, 0.1, size=self.action_dim)
        return self._current()

    def sample(self) -> np.ndarray:
        """
        Advance the OU process and return exploration noise.

        Returns
        -------
        np.ndarray
            float32 vector of shape (action_dim,) to add to Actor output.
        """
        sqrt_dt = np.sqrt(self.dt)
        dx = (
            self._theta * (self._mu_vec - self._state) * self.dt
            + self._sigma * sqrt_dt * self._rng.standard_normal(self.action_dim)
        )
        self._state = self._state + dx

        if self.max_noise is not None:
            self._state = np.clip(self._state, -self.max_noise, self.max_noise)

        return self._current()

    def _current(self) -> np.ndarray:
        return self._state.astype(np.float32).copy()

    @property
    def state(self) -> np.ndarray:
        """Internal OU state (read-only view)."""
        return self._current()

    def decay_sigma(self, factor: float = 0.995, min_sigma: float = 0.01) -> None:
        """
        Gradually reduce exploration (common DDPG training schedule).

        σ ← max(σ · factor, min_sigma) element-wise.
        """
        self._sigma = np.maximum(self._sigma * factor, min_sigma)

    def set_sigma(self, sigma: float | np.ndarray) -> None:
        """Restore or set volatility (e.g. after evaluation)."""
        self._sigma = self._as_dim_vector(sigma, "sigma")

    def restore_sigma(self) -> None:
        """Reset σ to initial values from construction."""
        self._sigma = self._sigma_initial.copy()

    @classmethod
    def from_config(cls, config: OUNoiseConfig) -> OUNoise:
        return cls(
            action_dim=config.action_dim,
            mu=config.mu,
            theta=config.theta,
            sigma=config.sigma,
            dt=config.dt,
            max_noise=config.max_noise,
            seed=config.seed,
        )

    @classmethod
    def from_gym_env(
        cls,
        env: Any,
        *,
        sigma: float = DEFAULT_SIGMA,
        theta: float = DEFAULT_THETA,
        dt: float = DEFAULT_DT,
        seed: int | None = None,
    ) -> OUNoise:
        """Build noise with ``action_space.shape[0]`` from Gymnasium env."""
        action_dim = int(env.action_space.shape[0])  # type: ignore[attr-defined]
        return cls(
            action_dim=action_dim,
            sigma=sigma,
            theta=theta,
            dt=dt,
            seed=seed,
        )

    @classmethod
    def for_heterogeneous_chargers(
        cls,
        bidirectional_mask: np.ndarray,
        *,
        sigma_l2: float = 0.15,
        sigma_dc: float = 0.25,
        theta: float = DEFAULT_THETA,
        dt: float = DEFAULT_DT,
        seed: int | None = None,
    ) -> OUNoise:
        """
        Per-charger σ: lower on Level-2, higher on DC/V2B for more exploration.

        ``bidirectional_mask[i]`` True → uses ``sigma_dc``, else ``sigma_l2``.
        """
        mask = np.asarray(bidirectional_mask, dtype=bool).reshape(-1)
        sigma_vec = np.where(mask, sigma_dc, sigma_l2)
        return cls(
            action_dim=mask.size,
            sigma=sigma_vec,
            theta=theta,
            dt=dt,
            seed=seed,
        )


def apply_noise_to_action(
    action: np.ndarray,
    noise: np.ndarray,
    *,
    low: float = -1.0,
    high: float = 1.0,
) -> np.ndarray:
    """
    Add OU noise to Actor output and clip to Gymnasium Box bounds.

    Compatible with tanh actions from ``Actor.act``.
    """
    return np.clip(
        np.asarray(action, dtype=np.float32) + np.asarray(noise, dtype=np.float32),
        low,
        high,
    ).astype(np.float32)


def main() -> None:
    """Smoke test: correlated noise over time."""
    ou = OUNoise(action_dim=6, sigma=0.3, theta=0.15, dt=0.01, seed=42)
    ou.reset()

    samples = [ou.sample() for _ in range(200)]
    arr = np.stack(samples)
    print("action_dim:", ou.action_dim)
    print("mean |noise|:", np.mean(np.abs(arr)))
    print("autocorr lag-1 (dim 0):", np.corrcoef(arr[:-1, 0], arr[1:, 0])[0, 1])
    print("sample step 0:", np.round(samples[0], 4))
    print("sample step 50:", np.round(samples[50], 4))

    ou.decay_sigma(0.9)
    print("sigma after decay:", ou._sigma)


if __name__ == "__main__":
    main()
