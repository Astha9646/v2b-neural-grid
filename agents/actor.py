"""
DDPG Actor network for V2B heterogeneous charger control (arXiv:2502.18526).

Maps normalized state vectors s(T_j) ∈ [0, 1]^d to bounded continuous actions
a(T_j) ∈ [-1, 1]^N (tanh), one dimension per charger. The environment or action
mask scales tanh outputs to physical power [C^min, C^max] in kW.

Paper default: two hidden layers with 96 ReLU units, tanh output (Section 4.2.4).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

import numpy as np
import torch
import torch.nn as nn

# Default state dimension from rl_env.state_builder (site-level features)
DEFAULT_STATE_DIM = 23

# Paper Section 4.2.4: two hidden layers × 96 neurons
DEFAULT_HIDDEN_DIMS = (96, 96)


@dataclass
class ActorConfig:
    """Hyperparameters for the policy network."""

    state_dim: int = DEFAULT_STATE_DIM
    action_dim: int = 8  # number of heterogeneous chargers N
    hidden_dims: tuple[int, ...] = DEFAULT_HIDDEN_DIMS
    # Final layer init scale (small weights → near-zero initial actions)
    init_final_weight: float = 3e-3
    init_final_bias: float = 0.0


def _build_mlp_layers(
    state_dim: int,
    action_dim: int,
    hidden_dims: Iterable[int],
) -> nn.Sequential:
    """Fully connected trunk: Linear → ReLU for each hidden size."""
    layers: list[nn.Module] = []
    in_dim = state_dim
    for h in hidden_dims:
        layers.append(nn.Linear(in_dim, h))
        layers.append(nn.ReLU())
        in_dim = h
    layers.append(nn.Linear(in_dim, action_dim))
    return nn.Sequential(*layers)


def init_actor_weights(module: nn.Module, config: ActorConfig) -> None:
    """
    DDPG-style initialization: orthogonal hidden layers, small final layer.

    Small final weights keep initial policies near zero before exploration noise.
    """
    hidden_done = False
    for submodule in module.modules():
        if isinstance(submodule, nn.Linear):
            nn.init.orthogonal_(submodule.weight, gain=np.sqrt(2))
            nn.init.constant_(submodule.bias, 0.0)
            # Last linear layer in the Sequential (no ReLU after it)
            if submodule.out_features == config.action_dim:
                nn.init.uniform_(
                    submodule.weight,
                    -config.init_final_weight,
                    config.init_final_weight,
                )
                nn.init.constant_(submodule.bias, config.init_final_bias)


class Actor(nn.Module):
    """
    Deterministic policy μ(s | θ) for DDPG continuous control.

    Parameters
    ----------
    config:
        Network sizes and initialization.
    c_min, c_max:
        Optional per-charger power limits [kW] for ``scale_to_power``.
        Shape (action_dim,). If omitted, only [-1, 1] tanh actions are returned.

    Forward
    -------
    state : (batch, state_dim) or (state_dim,)
        Normalized observation from ``StateBuilder`` / ``V2BChargingEnv``.

    Returns
    -------
    action : (batch, action_dim) or (action_dim,)
        Tanh-bounded actions in [-1, 1] per charger (charge/discharge sign).
    """

    def __init__(
        self,
        config: ActorConfig | None = None,
        *,
        c_min: torch.Tensor | np.ndarray | None = None,
        c_max: torch.Tensor | np.ndarray | None = None,
    ) -> None:
        super().__init__()
        self.config = config or ActorConfig()
        self.state_dim = self.config.state_dim
        self.action_dim = self.config.action_dim

        self.net = _build_mlp_layers(
            self.state_dim,
            self.action_dim,
            self.config.hidden_dims,
        )
        init_actor_weights(self.net, self.config)

        # Heterogeneous charger limits for optional power scaling (buffers, not trained)
        self._register_power_limits(c_min, c_max)

    def _register_power_limits(
        self,
        c_min: torch.Tensor | np.ndarray | None,
        c_max: torch.Tensor | np.ndarray | None,
    ) -> None:
        n = self.action_dim
        if c_min is None:
            c_min_t = torch.full((n,), -1.0)
        else:
            c_min_t = torch.as_tensor(c_min, dtype=torch.float32).reshape(n)
        if c_max is None:
            c_max_t = torch.ones(n,)
        else:
            c_max_t = torch.as_tensor(c_max, dtype=torch.float32).reshape(n)
        self.register_buffer("c_min_kw", c_min_t)
        self.register_buffer("c_max_kw", c_max_t)

    def forward(
        self,
        state: torch.Tensor,
        *,
        return_pre_tanh: bool = False,
    ) -> torch.Tensor:
        """
        Compute μ(s) with tanh output squashing.

        Parameters
        ----------
        state:
            Float tensor on any device; shape (B, state_dim) or (state_dim,).
        return_pre_tanh:
            If True, return linear head output before tanh (for analysis).

        Returns
        -------
        action:
            Tanh output in [-1, 1], shape (B, action_dim) or (action_dim,).
        """
        single = state.dim() == 1
        if single:
            state = state.unsqueeze(0)

        if state.shape[-1] != self.state_dim:
            raise ValueError(
                f"Expected state dim {self.state_dim}, got {state.shape[-1]}"
            )

        logits = self.net(state)
        if return_pre_tanh:
            action = logits
        else:
            action = torch.tanh(logits)

        if single:
            action = action.squeeze(0)
        return action

    @torch.no_grad()
    def act(
        self,
        state: np.ndarray | torch.Tensor,
        *,
        device: torch.device | str | None = None,
        noise: np.ndarray | torch.Tensor | None = None,
        scale_to_kw: bool = False,
    ) -> np.ndarray:
        """
        Single-step or batch inference for Gymnasium / rollout collection.

        Parameters
        ----------
        state:
            (state_dim,) or (batch, state_dim), values in [0, 1].
        noise:
            Optional exploration noise (e.g. Ornstein–Uhlenbeck), same shape as action.
        scale_to_kw:
            If True, map tanh output to [c_min_kw, c_max_kw] in kW.

        Returns
        -------
        np.ndarray
            Actions as float32 numpy array.
        """
        self.eval()
        dev = device or next(self.parameters()).device
        st = torch.as_tensor(state, dtype=torch.float32, device=dev)
        if st.dim() == 1:
            st = st.unsqueeze(0)
        action = self.forward(st)
        if noise is not None:
            n = torch.as_tensor(noise, dtype=torch.float32, device=dev)
            if n.dim() == 1:
                n = n.unsqueeze(0)
            action = torch.clamp(action + n, -1.0, 1.0)
        if scale_to_kw:
            action = self.scale_to_power(action)
        return action.cpu().numpy().astype(np.float32).reshape(-1, self.action_dim)

    def scale_to_power(self, action_tanh: torch.Tensor) -> torch.Tensor:
        """
        Map tanh actions to physical charger power [kW] (paper Eq. scaling).

            P_i = 0.5 * (tanh_i + 1) * (C^max_i - C^min_i) + C^min_i

        Compatible with ``rl_env.action_mask.scale_tanh_to_power``.
        """
        t = torch.clamp(action_tanh, -1.0, 1.0)
        c_min = self.c_min_kw.to(t.device)
        c_max = self.c_max_kw.to(t.device)
        return 0.5 * (t + 1.0) * (c_max - c_min) + c_min

    def set_power_limits(
        self,
        c_min: np.ndarray | torch.Tensor,
        c_max: np.ndarray | torch.Tensor,
    ) -> None:
        """Update heterogeneous limits when charger configuration changes."""
        self.c_min_kw.copy_(torch.as_tensor(c_min, dtype=torch.float32).reshape(-1))
        self.c_max_kw.copy_(torch.as_tensor(c_max, dtype=torch.float32).reshape(-1))

    @classmethod
    def from_gym_env(
        cls,
        env: Any,
        *,
        hidden_dims: tuple[int, ...] = DEFAULT_HIDDEN_DIMS,
        device: torch.device | str = "cpu",
    ) -> Actor:
        """
        Build Actor from a ``V2BChargingEnv`` (or any Gymnasium env with Box spaces).

        Uses observation_space.shape[0] and action_space.shape[0].
        """
        state_dim = int(env.observation_space.shape[0])
        action_dim = int(env.action_space.shape[0])
        actor = cls(
            ActorConfig(
                state_dim=state_dim,
                action_dim=action_dim,
                hidden_dims=hidden_dims,
            )
        )
        if hasattr(env, "_chargers"):
            c_min = np.array([c.c_min_kw for c in env._chargers], dtype=np.float32)
            c_max = np.array([c.c_max_kw for c in env._chargers], dtype=np.float32)
            actor.set_power_limits(c_min, c_max)
        return actor.to(device)

    def count_parameters(self) -> int:
        return sum(p.numel() for p in self.parameters() if p.requires_grad)


def main() -> None:
    """Smoke test: forward pass and power scaling."""
    batch = 4
    cfg = ActorConfig(state_dim=23, action_dim=6, hidden_dims=(96, 96))
    c_min = np.array([0, 0, 0, -50, -50, -50], dtype=np.float32)
    c_max = np.array([7.2, 7.2, 7.2, 50, 50, 50], dtype=np.float32)
    actor = Actor(cfg, c_min=c_min, c_max=c_max)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    actor.to(device)

    state = torch.rand(batch, cfg.state_dim, device=device)
    action = actor(state)
    power = actor.scale_to_power(action)

    print("device:", device)
    print("action shape:", action.shape, "range:", action.min().item(), action.max().item())
    print("power_kw shape:", power.shape)
    print("parameters:", actor.count_parameters())

    single = actor.act(state[0].cpu().numpy(), device=device, scale_to_kw=True)
    print("single act (kW):", np.round(single, 2))


if __name__ == "__main__":
    main()
