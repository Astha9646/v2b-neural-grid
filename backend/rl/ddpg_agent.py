"""
DDPG agent: actor/critic, target networks, replay, soft updates, OU-style noise.
"""

from __future__ import annotations

import copy
import logging
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

from backend.rl.networks import Actor, Critic, NetworkConfig
from backend.rl.replay_buffer import ReplayBuffer
from backend.rl.rl_config import RLConfig, resolve_device

logger = logging.getLogger(__name__)


@dataclass
class LearnStats:
    critic_loss: float = 0.0
    actor_loss: float = 0.0
    q_mean: float = 0.0


class TelemetryDDPGAgent:
    """Deep Deterministic Policy Gradient for telemetry grid control."""

    def __init__(self, config: RLConfig) -> None:
        self.config = config
        self.device = torch.device(resolve_device(config.device))

        net_cfg = NetworkConfig(
            state_dim=config.state_dim,
            action_dim=config.action_dim,
            hidden_dims=config.hidden_dims,
        )
        self.actor = Actor(net_cfg).to(self.device)
        self.critic = Critic(net_cfg).to(self.device)
        self.actor_target = copy.deepcopy(self.actor).to(self.device)
        self.critic_target = copy.deepcopy(self.critic).to(self.device)

        self.actor_opt = torch.optim.Adam(self.actor.parameters(), lr=config.lr_actor)
        self.critic_opt = torch.optim.Adam(self.critic.parameters(), lr=config.lr_critic)

        self.buffer = ReplayBuffer(
            config.replay_capacity,
            config.state_dim,
            config.action_dim,
            batch_size=config.batch_size,
            seed=config.random_seed,
        )

        self.noise_sigma = config.noise_sigma
        self.total_steps = 0
        self.learn_steps = 0

    def select_action(self, state: np.ndarray, *, explore: bool = False) -> np.ndarray:
        s = torch.as_tensor(state, dtype=torch.float32, device=self.device).unsqueeze(0)
        with torch.no_grad():
            action = self.actor(s).cpu().numpy().flatten()
        if explore:
            noise = np.random.normal(0, self.noise_sigma, size=action.shape)
            action = np.clip(action + noise, -1.0, 1.0)
        return action.astype(np.float32)

    def decay_noise(self) -> None:
        self.noise_sigma = max(
            self.config.min_noise_sigma,
            self.noise_sigma * self.config.noise_decay,
        )

    def store(
        self,
        state: np.ndarray,
        action: np.ndarray,
        reward: float,
        next_state: np.ndarray,
        done: bool,
    ) -> None:
        self.buffer.add(state, action, reward, next_state, done)
        self.total_steps += 1

    def learn(self) -> LearnStats | None:
        if not self.buffer.is_ready:
            return None
        if self.total_steps < self.config.warmup_steps:
            return None
        if self.total_steps % self.config.learn_every != 0:
            return None

        states, actions, rewards, next_states, dones = self.buffer.sample()
        stats = self._update(
            states, actions, rewards, next_states, dones
        )
        self.learn_steps += 1
        return stats

    def _update(
        self,
        states: np.ndarray,
        actions: np.ndarray,
        rewards: np.ndarray,
        next_states: np.ndarray,
        dones: np.ndarray,
    ) -> LearnStats:
        s = torch.as_tensor(states, device=self.device)
        a = torch.as_tensor(actions, device=self.device)
        r = torch.as_tensor(rewards, device=self.device)
        ns = torch.as_tensor(next_states, device=self.device)
        d = torch.as_tensor(dones, device=self.device)

        with torch.no_grad():
            next_a = self.actor_target(ns)
            target_q = self.critic_target(ns, next_a)
            y = r + (1.0 - d) * self.config.gamma * target_q

        q = self.critic(s, a)
        critic_loss = F.mse_loss(q, y)

        self.critic_opt.zero_grad()
        critic_loss.backward()
        if self.config.gradient_clip > 0:
            torch.nn.utils.clip_grad_norm_(
                self.critic.parameters(), self.config.gradient_clip
            )
        self.critic_opt.step()

        actor_loss = -self.critic(s, self.actor(s)).mean()
        self.actor_opt.zero_grad()
        actor_loss.backward()
        if self.config.gradient_clip > 0:
            torch.nn.utils.clip_grad_norm_(
                self.actor.parameters(), self.config.gradient_clip
            )
        self.actor_opt.step()

        self._soft_update(self.actor, self.actor_target)
        self._soft_update(self.critic, self.critic_target)

        return LearnStats(
            critic_loss=float(critic_loss.item()),
            actor_loss=float(actor_loss.item()),
            q_mean=float(q.mean().item()),
        )

    def _soft_update(self, source: torch.nn.Module, target: torch.nn.Module) -> None:
        tau = self.config.tau
        for tp, sp in zip(target.parameters(), source.parameters()):
            tp.data.copy_(tau * sp.data + (1.0 - tau) * tp.data)

    def save(self, directory: Path | None = None) -> tuple[Path, Path]:
        directory = Path(directory or self.config.checkpoint_dir)
        directory.mkdir(parents=True, exist_ok=True)
        actor_path = directory / "ddpg_actor.pth"
        critic_path = directory / "ddpg_critic.pth"
        meta_path = directory / "ddpg_meta.pth"

        torch.save(self.actor.state_dict(), actor_path)
        torch.save(self.critic.state_dict(), critic_path)
        from backend.rl.rl_config import ACTION_NAMES, STATE_FEATURE_NAMES

        torch.save(
            {
                "state_dim": self.config.state_dim,
                "action_dim": self.config.action_dim,
                "hidden_dims": self.config.hidden_dims,
                "norm_caps": self.config.norm_caps,
                "state_features": list(STATE_FEATURE_NAMES),
                "action_names": list(ACTION_NAMES),
                "total_steps": self.total_steps,
                "learn_steps": self.learn_steps,
            },
            meta_path,
        )
        logger.info("Saved DDPG checkpoints: %s, %s", actor_path, critic_path)
        return actor_path, critic_path

    def load(self, directory: Path | None = None) -> None:
        directory = Path(directory or self.config.checkpoint_dir)
        self.actor.load_state_dict(
            torch.load(directory / "ddpg_actor.pth", map_location=self.device, weights_only=True)
        )
        self.critic.load_state_dict(
            torch.load(directory / "ddpg_critic.pth", map_location=self.device, weights_only=True)
        )
        self._hard_sync_targets()
        meta_path = directory / "ddpg_meta.pth"
        if meta_path.is_file():
            meta = torch.load(meta_path, map_location="cpu", weights_only=True)
            self.total_steps = int(meta.get("total_steps", 0))
            self.learn_steps = int(meta.get("learn_steps", 0))
        logger.info("Loaded DDPG from %s", directory)

    def _hard_sync_targets(self) -> None:
        self.actor_target.load_state_dict(self.actor.state_dict())
        self.critic_target.load_state_dict(self.critic.state_dict())
