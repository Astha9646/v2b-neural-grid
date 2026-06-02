"""
DDPG Critic network for V2B heterogeneous charger control (arXiv:2502.18526).

Estimates the action-value function Q(s, a | φ) for continuous charging/discharging
actions across N chargers. Uses separate state and action encoders, then a shared
fusion trunk — standard DDPG design for stable Q-learning with deterministic policies.

Paper default: fully connected layers with 96 ReLU units; scalar Q output (Section 4.2.4).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

import numpy as np
import torch
import torch.nn as nn

# Align with agents.actor / rl_env.state_builder (avoid import path issues in scripts)
DEFAULT_STATE_DIM = 23
DEFAULT_HIDDEN_DIMS = (96, 96)
DEFAULT_BRANCH_DIM = 96


@dataclass
class CriticConfig:
    """Hyperparameters for the Q-network."""

    state_dim: int = DEFAULT_STATE_DIM
    action_dim: int = 8
    state_branch_dim: int = DEFAULT_BRANCH_DIM
    action_branch_dim: int = DEFAULT_BRANCH_DIM
    fusion_hidden_dims: tuple[int, ...] = DEFAULT_HIDDEN_DIMS
    init_final_weight: float = 3e-3


def _make_branch(in_dim: int, out_dim: int) -> nn.Sequential:
    """Single hidden branch: Linear → ReLU."""
    return nn.Sequential(
        nn.Linear(in_dim, out_dim),
        nn.ReLU(),
    )


def _make_fusion_trunk(
    in_dim: int,
    hidden_dims: Iterable[int],
) -> nn.Sequential:
    """Post-concatenation MLP ending in scalar Q."""
    layers: list[nn.Module] = []
    dim = in_dim
    for h in hidden_dims:
        layers.append(nn.Linear(dim, h))
        layers.append(nn.ReLU())
        dim = h
    layers.append(nn.Linear(dim, 1))
    return nn.Sequential(*layers)


def init_critic_weights(module: nn.Module, config: CriticConfig) -> None:
    """
    Orthogonal init on all Linear layers; small weights on final Q head.

    Keeps initial Q estimates near zero for stable early DDPG updates.
    """
    for submodule in module.modules():
        if isinstance(submodule, nn.Linear):
            if submodule.out_features == 1:
                nn.init.uniform_(
                    submodule.weight,
                    -config.init_final_weight,
                    config.init_final_weight,
                )
                nn.init.constant_(submodule.bias, 0.0)
            else:
                nn.init.orthogonal_(submodule.weight, gain=np.sqrt(2))
                nn.init.constant_(submodule.bias, 0.0)


class Critic(nn.Module):
    """
    Deep Q-network Q(s, a) for continuous actions (DDPG critic).

    Architecture
    ------------
    1. State branch:  s → FC → ReLU  → h_s
    2. Action branch: a → FC → ReLU  → h_a
    3. Fusion:       [h_s ; h_a] → FC → ReLU → … → scalar Q

    Parameters
    ----------
    config:
        Dimensions for state, action, branches, and fusion MLP.

    Forward
    -------
    state : (batch, state_dim) or (state_dim,)
        Normalized observation.
    action : (batch, action_dim) or (action_dim,)
        Continuous actions (typically tanh in [-1, 1] per charger).

    Returns
    -------
    q_value : (batch, 1) or (1,)
        Scalar Q estimate per transition.
    """

    def __init__(self, config: CriticConfig | None = None) -> None:
        super().__init__()
        self.config = config or CriticConfig()
        self.state_dim = self.config.state_dim
        self.action_dim = self.config.action_dim

        self.state_branch = _make_branch(
            self.state_dim,
            self.config.state_branch_dim,
        )
        self.action_branch = _make_branch(
            self.action_dim,
            self.config.action_branch_dim,
        )
        fusion_in = self.config.state_branch_dim + self.config.action_branch_dim
        self.fusion = _make_fusion_trunk(fusion_in, self.config.fusion_hidden_dims)

        init_critic_weights(self, self.config)

    def forward(
        self,
        state: torch.Tensor,
        action: torch.Tensor,
    ) -> torch.Tensor:
        """
        Evaluate Q(s, a).

        Supports batched and single transitions; returns shape (B, 1) or (1,).
        """
        single = state.dim() == 1
        if single:
            state = state.unsqueeze(0)
            action = action.unsqueeze(0)

        if state.shape[-1] != self.state_dim:
            raise ValueError(
                f"Expected state dim {self.state_dim}, got {state.shape[-1]}"
            )
        if action.shape[-1] != self.action_dim:
            raise ValueError(
                f"Expected action dim {self.action_dim}, got {action.shape[-1]}"
            )
        if state.shape[0] != action.shape[0]:
            raise ValueError(
                f"Batch size mismatch: state {state.shape[0]} vs action {action.shape[0]}"
            )

        h_s = self.state_branch(state)
        h_a = self.action_branch(action)
        fused = torch.cat([h_s, h_a], dim=-1)
        q = self.fusion(fused)

        if single:
            q = q.squeeze(0)
        return q

    @torch.no_grad()
    def q_value(
        self,
        state: np.ndarray | torch.Tensor,
        action: np.ndarray | torch.Tensor,
        *,
        device: torch.device | str | None = None,
    ) -> np.ndarray:
        """
        Numpy inference helper for logging or diagnostics.

        Returns
        -------
        np.ndarray
            Shape (batch,) float32 Q-values.
        """
        self.eval()
        dev = device or next(self.parameters()).device
        s = torch.as_tensor(state, dtype=torch.float32, device=dev)
        a = torch.as_tensor(action, dtype=torch.float32, device=dev)
        if s.dim() == 1:
            s = s.unsqueeze(0)
            a = a.unsqueeze(0)
        q = self.forward(s, a)
        return q.cpu().numpy().astype(np.float32).reshape(-1)

    @classmethod
    def from_gym_env(
        cls,
        env: Any,
        *,
        state_branch_dim: int = DEFAULT_BRANCH_DIM,
        action_branch_dim: int = DEFAULT_BRANCH_DIM,
        fusion_hidden_dims: tuple[int, ...] = DEFAULT_HIDDEN_DIMS,
        device: torch.device | str = "cpu",
    ) -> Critic:
        """Instantiate from Gymnasium Box observation/action spaces."""
        cfg = CriticConfig(
            state_dim=int(env.observation_space.shape[0]),
            action_dim=int(env.action_space.shape[0]),
            state_branch_dim=state_branch_dim,
            action_branch_dim=action_branch_dim,
            fusion_hidden_dims=fusion_hidden_dims,
        )
        return cls(cfg).to(device)

    def count_parameters(self) -> int:
        return sum(p.numel() for p in self.parameters() if p.requires_grad)


class TwinCritic(nn.Module):
    """
    Optional twin Q-networks (TD3-style) for reduced overestimation.

    Exposes the same ``forward`` API; returns min(Q1, Q2) when both are used.
    """

    def __init__(self, config: CriticConfig | None = None) -> None:
        super().__init__()
        self.q1 = Critic(config)
        self.q2 = Critic(config)

    def forward(
        self,
        state: torch.Tensor,
        action: torch.Tensor,
        *,
        use_min: bool = True,
    ) -> torch.Tensor:
        q1 = self.q1(state, action)
        q2 = self.q2(state, action)
        if use_min:
            return torch.min(q1, q2)
        return q1, q2


def main() -> None:
    """Smoke test: batched Q(s, a)."""
    batch = 8
    cfg = CriticConfig(state_dim=23, action_dim=6)
    critic = Critic(cfg)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    critic.to(device)

    state = torch.rand(batch, cfg.state_dim, device=device)
    action = torch.tanh(torch.randn(batch, cfg.action_dim, device=device))
    q = critic(state, action)

    print("device:", device)
    print("Q shape:", q.shape, "sample Q:", q[:3].flatten().tolist())
    print("parameters:", critic.count_parameters())

    single_q = critic.q_value(
        state[0].cpu().numpy(),
        action[0].cpu().numpy(),
        device=device,
    )
    print("single Q:", single_q)


if __name__ == "__main__":
    main()
