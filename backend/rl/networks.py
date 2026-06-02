"""
Actor and critic networks for telemetry DDPG.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import torch
import torch.nn as nn


@dataclass
class NetworkConfig:
    state_dim: int
    action_dim: int
    hidden_dims: tuple[int, ...] = (256, 256)


def _mlp(in_dim: int, hidden: tuple[int, ...], out_dim: int) -> nn.Sequential:
    layers: list[nn.Module] = []
    d = in_dim
    for h in hidden:
        layers += [nn.Linear(d, h), nn.ReLU()]
        d = h
    layers.append(nn.Linear(d, out_dim))
    return nn.Sequential(*layers)


def _init_policy(module: nn.Module, action_dim: int) -> None:
    for m in module.modules():
        if isinstance(m, nn.Linear):
            nn.init.orthogonal_(m.weight, gain=np.sqrt(2))
            nn.init.constant_(m.bias, 0.0)
            if m.out_features == action_dim:
                nn.init.uniform_(m.weight, -3e-3, 3e-3)


class Actor(nn.Module):
    """Deterministic policy μ(s) → a ∈ [-1, 1]^d."""

    def __init__(self, config: NetworkConfig) -> None:
        super().__init__()
        self.net = _mlp(config.state_dim, config.hidden_dims, config.action_dim)
        _init_policy(self.net, config.action_dim)

    def forward(self, state: torch.Tensor) -> torch.Tensor:
        return torch.tanh(self.net(state))


class Critic(nn.Module):
    """Q(s, a) critic with state-action fusion."""

    def __init__(self, config: NetworkConfig) -> None:
        super().__init__()
        in_dim = config.state_dim + config.action_dim
        self.net = _mlp(in_dim, config.hidden_dims, 1)
        for m in self.modules():
            if isinstance(m, nn.Linear):
                nn.init.orthogonal_(m.weight, gain=np.sqrt(2))
                nn.init.constant_(m.bias, 0.0)

    def forward(self, state: torch.Tensor, action: torch.Tensor) -> torch.Tensor:
        x = torch.cat([state, action], dim=-1)
        return self.net(x)
