"""
DDPG agent for V2B heterogeneous charger control (arXiv:2502.18526).

Integrates Actor, Critic, target networks, replay buffer, and OU exploration.
Compatible with ``V2BChargingEnv`` and continuous Box action spaces.

Algorithm (Lillicrap et al., 2015):
  - Critic: minimize MSE(Q(s,a), y),  y = r + (1-d) γ Q'(s', μ'(s'))
  - Actor: maximize Q(s, μ(s))  → loss = -Q(s, μ(s))
  - Target soft update: θ' ← τ θ + (1-τ) θ'
"""

from __future__ import annotations

import copy
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from agents.actor import Actor, ActorConfig, DEFAULT_HIDDEN_DIMS, DEFAULT_STATE_DIM
from agents.critic import Critic, CriticConfig, DEFAULT_BRANCH_DIM
from agents.noise import OUNoise, apply_noise_to_action
from agents.replay_buffer import ReplayBuffer, DEFAULT_BATCH_SIZE, DEFAULT_CAPACITY

logger = logging.getLogger(__name__)

DEFAULT_GAMMA = 0.99
DEFAULT_TAU = 0.005
DEFAULT_LR_ACTOR = 1e-4
DEFAULT_LR_CRITIC = 1e-3
DEFAULT_WARMUP_STEPS = 1000
DEFAULT_LEARN_EVERY = 1


@dataclass
class DDPGConfig:
    """DDPG hyperparameters."""

    state_dim: int = DEFAULT_STATE_DIM
    action_dim: int = 8
    hidden_dims: tuple[int, ...] = DEFAULT_HIDDEN_DIMS
    gamma: float = DEFAULT_GAMMA
    tau: float = DEFAULT_TAU
    lr_actor: float = DEFAULT_LR_ACTOR
    lr_critic: float = DEFAULT_LR_CRITIC
    buffer_capacity: int = DEFAULT_CAPACITY
    batch_size: int = DEFAULT_BATCH_SIZE
    warmup_steps: int = DEFAULT_WARMUP_STEPS
    learn_every: int = DEFAULT_LEARN_EVERY
    gradient_clip_norm: float | None = 1.0
    device: str = "cpu"
    # OU noise
    ou_sigma: float = 0.2
    ou_theta: float = 0.15
    ou_dt: float = 0.01
    noise_decay: float = 0.995
    min_noise_sigma: float = 0.01
    seed: int | None = None


@dataclass
class LearnMetrics:
    """Training diagnostics from one ``learn()`` call."""

    critic_loss: float = 0.0
    actor_loss: float = 0.0
    q_mean: float = 0.0
    target_q_mean: float = 0.0

    def to_dict(self) -> dict[str, float]:
        return {
            "critic_loss": self.critic_loss,
            "actor_loss": self.actor_loss,
            "q_mean": self.q_mean,
            "target_q_mean": self.target_q_mean,
        }


class DDPGAgent:
    """
    Deep Deterministic Policy Gradient agent for V2B smart charging.

    Parameters
    ----------
    config:
        Network sizes, optimizers, replay, and exploration settings.
    actor, critic:
        Optional pre-built networks (else constructed from config).
    """

    def __init__(
        self,
        config: DDPGConfig | None = None,
        *,
        actor: Actor | None = None,
        critic: Critic | None = None,
    ) -> None:
        self.config = config or DDPGConfig()
        self.device = torch.device(self.config.device)

        if self.config.seed is not None:
            torch.manual_seed(self.config.seed)
            np.random.seed(self.config.seed)

        actor_cfg = ActorConfig(
            state_dim=self.config.state_dim,
            action_dim=self.config.action_dim,
            hidden_dims=self.config.hidden_dims,
        )
        critic_cfg = CriticConfig(
            state_dim=self.config.state_dim,
            action_dim=self.config.action_dim,
            fusion_hidden_dims=self.config.hidden_dims,
            state_branch_dim=DEFAULT_BRANCH_DIM,
            action_branch_dim=DEFAULT_BRANCH_DIM,
        )

        self.actor = (actor or Actor(actor_cfg)).to(self.device)
        self.critic = (critic or Critic(critic_cfg)).to(self.device)
        self.actor_target = copy.deepcopy(self.actor).to(self.device)
        self.critic_target = copy.deepcopy(self.critic).to(self.device)

        self._hard_update(self.actor_target, self.actor)
        self._hard_update(self.critic_target, self.critic)

        self.actor_optimizer = torch.optim.Adam(
            self.actor.parameters(),
            lr=self.config.lr_actor,
        )
        self.critic_optimizer = torch.optim.Adam(
            self.critic.parameters(),
            lr=self.config.lr_critic,
        )

        self.replay_buffer = ReplayBuffer(
            capacity=self.config.buffer_capacity,
            state_dim=self.config.state_dim,
            action_dim=self.config.action_dim,
            batch_size=self.config.batch_size,
            seed=self.config.seed,
        )

        self.noise = OUNoise(
            action_dim=self.config.action_dim,
            sigma=self.config.ou_sigma,
            theta=self.config.ou_theta,
            dt=self.config.ou_dt,
            seed=self.config.seed,
        )

        self.total_steps = 0
        self.learn_steps = 0

    # ------------------------------------------------------------------
    # Environment interaction
    # ------------------------------------------------------------------

    def reset_noise(self) -> None:
        """Reset OU noise at episode boundary."""
        self.noise.reset()

    def select_action(
        self,
        state: np.ndarray,
        *,
        explore: bool = True,
    ) -> np.ndarray:
        """
        Choose action for Gymnasium ``env.step``.

        Parameters
        ----------
        state:
            Observation (state_dim,), normalized.
        explore:
            If True, add OU noise and clip to [-1, 1] (training).
            If False, deterministic μ(s) (evaluation).

        Returns
        -------
        np.ndarray
            Shape (action_dim,) float32, compatible with ``V2BChargingEnv``.
        """
        self.actor.eval()
        with torch.no_grad():
            st = torch.as_tensor(state, dtype=torch.float32, device=self.device)
            action = self.actor(st).cpu().numpy().astype(np.float32).reshape(-1)

        if explore:
            noise = self.noise.sample()
            action = apply_noise_to_action(action, noise)
        return action

    def step(
        self,
        env: Any,
        state: np.ndarray,
        *,
        explore: bool = True,
    ) -> tuple[np.ndarray, float, bool, dict[str, Any], dict[str, float]]:
        """
        Execute one environment step: act → step → store → optional learn.

        Returns
        -------
        next_state, reward, done, info, train_metrics
        """
        action = self.select_action(state, explore=explore)
        next_state, reward, terminated, truncated, info = env.step(action)
        done = bool(terminated or truncated)

        self.replay_buffer.add(state, action, float(reward), next_state, done)
        self.total_steps += 1

        metrics: dict[str, float] = {}
        if self._should_learn():
            lm = self.learn()
            metrics = lm.to_dict()
            if self.config.noise_decay < 1.0:
                self.noise.decay_sigma(
                    self.config.noise_decay,
                    self.config.min_noise_sigma,
                )

        return (
            np.asarray(next_state, dtype=np.float32),
            float(reward),
            done,
            info,
            metrics,
        )

    # ------------------------------------------------------------------
    # Learning
    # ------------------------------------------------------------------

    def _should_learn(self) -> bool:
        return (
            self.total_steps >= self.config.warmup_steps
            and self.replay_buffer.is_ready
            and self.total_steps % self.config.learn_every == 0
        )

    def learn(self) -> LearnMetrics:
        """
        One DDPG update: sample batch → train critic → train actor → soft-update targets.

        Returns
        -------
        LearnMetrics
            Losses and Q statistics for logging.
        """
        if not self.replay_buffer.is_ready:
            return LearnMetrics()

        states, actions, rewards, next_states, dones = self.replay_buffer.sample(
            self.config.batch_size
        )

        states_t = torch.as_tensor(states, device=self.device)
        actions_t = torch.as_tensor(actions, device=self.device)
        rewards_t = torch.as_tensor(rewards, device=self.device)
        next_states_t = torch.as_tensor(next_states, device=self.device)
        dones_t = torch.as_tensor(dones, device=self.device)

        # --- Critic update ---
        self.critic.train()
        self.actor_target.eval()
        self.critic_target.eval()

        with torch.no_grad():
            next_actions = self.actor_target(next_states_t)
            target_q = self.critic_target(next_states_t, next_actions)
            y = rewards_t + (1.0 - dones_t) * self.config.gamma * target_q

        current_q = self.critic(states_t, actions_t)
        critic_loss = F.mse_loss(current_q, y)

        self.critic_optimizer.zero_grad()
        critic_loss.backward()
        if self.config.gradient_clip_norm is not None:
            nn.utils.clip_grad_norm_(
                self.critic.parameters(),
                self.config.gradient_clip_norm,
            )
        self.critic_optimizer.step()

        # --- Actor update (deterministic policy gradient) ---
        self.actor.train()
        self.critic.eval()

        policy_actions = self.actor(states_t)
        actor_loss = -self.critic(states_t, policy_actions).mean()

        self.actor_optimizer.zero_grad()
        actor_loss.backward()
        if self.config.gradient_clip_norm is not None:
            nn.utils.clip_grad_norm_(
                self.actor.parameters(),
                self.config.gradient_clip_norm,
            )
        self.actor_optimizer.step()

        # --- Target networks ---
        self.soft_update(self.actor_target, self.actor, self.config.tau)
        self.soft_update(self.critic_target, self.critic, self.config.tau)

        self.learn_steps += 1

        return LearnMetrics(
            critic_loss=float(critic_loss.item()),
            actor_loss=float(actor_loss.item()),
            q_mean=float(current_q.mean().item()),
            target_q_mean=float(y.mean().item()),
        )

    @staticmethod
    def soft_update(
        target: nn.Module,
        source: nn.Module,
        tau: float,
    ) -> None:
        """
        Polyak averaging: θ_target ← τ θ + (1-τ) θ_target.

        Standard DDPG target network update.
        """
        with torch.no_grad():
            for tp, sp in zip(target.parameters(), source.parameters()):
                tp.data.mul_(1.0 - tau).add_(sp.data, alpha=tau)

    @staticmethod
    def _hard_update(target: nn.Module, source: nn.Module) -> None:
        target.load_state_dict(source.state_dict())

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def save_models(self, directory: str | Path) -> Path:
        """
        Save actor, critic, targets, optimizers, and config.

        Files written under ``directory``:
          actor.pt, critic.pt, actor_target.pt, critic_target.pt,
          optimizers.pt, meta.pt
        """
        directory = Path(directory)
        directory.mkdir(parents=True, exist_ok=True)

        torch.save(self.actor.state_dict(), directory / "actor.pt")
        torch.save(self.critic.state_dict(), directory / "critic.pt")
        torch.save(self.actor_target.state_dict(), directory / "actor_target.pt")
        torch.save(self.critic_target.state_dict(), directory / "critic_target.pt")
        torch.save(
            {
                "actor": self.actor_optimizer.state_dict(),
                "critic": self.critic_optimizer.state_dict(),
            },
            directory / "optimizers.pt",
        )
        torch.save(
            {
                "config": self.config.__dict__,
                "total_steps": self.total_steps,
                "learn_steps": self.learn_steps,
            },
            directory / "meta.pt",
        )
        logger.info("Saved DDPG checkpoints to %s", directory)
        return directory

    def load_models(
        self,
        directory: str | Path,
        *,
        load_optimizers: bool = True,
    ) -> None:
        """Load checkpoints produced by ``save_models``."""
        directory = Path(directory)
        self.actor.load_state_dict(
            torch.load(directory / "actor.pt", map_location=self.device, weights_only=True)
        )
        self.critic.load_state_dict(
            torch.load(directory / "critic.pt", map_location=self.device, weights_only=True)
        )
        self.actor_target.load_state_dict(
            torch.load(
                directory / "actor_target.pt",
                map_location=self.device,
                weights_only=True,
            )
        )
        self.critic_target.load_state_dict(
            torch.load(
                directory / "critic_target.pt",
                map_location=self.device,
                weights_only=True,
            )
        )

        if load_optimizers and (directory / "optimizers.pt").exists():
            opts = torch.load(
                directory / "optimizers.pt",
                map_location=self.device,
                weights_only=True,
            )
            self.actor_optimizer.load_state_dict(opts["actor"])
            self.critic_optimizer.load_state_dict(opts["critic"])

        meta_path = directory / "meta.pt"
        if meta_path.exists():
            meta = torch.load(meta_path, map_location="cpu", weights_only=True)
            self.total_steps = int(meta.get("total_steps", 0))
            self.learn_steps = int(meta.get("learn_steps", 0))

        logger.info("Loaded DDPG checkpoints from %s", directory)

    # ------------------------------------------------------------------
    # Factory
    # ------------------------------------------------------------------

    @classmethod
    def from_gym_env(
        cls,
        env: Any,
        *,
        config: DDPGConfig | None = None,
        device: str | None = None,
    ) -> DDPGAgent:
        """Build agent from ``V2BChargingEnv`` observation/action spaces."""
        state_dim = int(env.observation_space.shape[0])
        action_dim = int(env.action_space.shape[0])

        cfg = config or DDPGConfig()
        cfg.state_dim = state_dim
        cfg.action_dim = action_dim
        if device is not None:
            cfg.device = device
        elif torch.cuda.is_available():
            cfg.device = "cuda"

        agent = cls(cfg)

        if hasattr(env, "_chargers"):
            c_min = np.array([c.c_min_kw for c in env._chargers], dtype=np.float32)
            c_max = np.array([c.c_max_kw for c in env._chargers], dtype=np.float32)
            agent.actor.set_power_limits(c_min, c_max)
            agent.actor_target.set_power_limits(c_min, c_max)

        return agent

    def set_eval_mode(self) -> None:
        """Deterministic policies for deployment / evaluation."""
        self.actor.eval()
        self.critic.eval()
        self.noise.restore_sigma()

    def set_train_mode(self) -> None:
        self.actor.train()
        self.critic.train()


def train_episode(
    agent: DDPGAgent,
    env: Any,
    *,
    max_steps: int | None = None,
) -> dict[str, Any]:
    """
    Run one Gymnasium episode with the DDPG agent.

    Returns episode statistics (return, length, mean losses).
    """
    state, _ = env.reset()
    agent.reset_noise()

    episode_return = 0.0
    length = 0
    critic_losses: list[float] = []
    actor_losses: list[float] = []

    while True:
        next_state, reward, done, info, metrics = agent.step(env, state, explore=True)
        episode_return += reward
        length += 1
        state = next_state

        if metrics:
            critic_losses.append(metrics.get("critic_loss", 0.0))
            actor_losses.append(metrics.get("actor_loss", 0.0))

        if done or (max_steps is not None and length >= max_steps):
            break

    return {
        "episode_return": episode_return,
        "episode_length": length,
        "mean_critic_loss": float(np.mean(critic_losses)) if critic_losses else 0.0,
        "mean_actor_loss": float(np.mean(actor_losses)) if actor_losses else 0.0,
    }


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    from rl_env.ev_env import make_v2b_env

    env = make_v2b_env(num_chargers=4, episode_slots=12, seed=0)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    agent = DDPGAgent.from_gym_env(env, device=device)
    agent.config.warmup_steps = 50
    agent.config.batch_size = 16

    stats = train_episode(agent, env, max_steps=12)
    print("device:", device)
    print("episode:", stats)
    print("buffer len:", len(agent.replay_buffer))
    print("learn steps:", agent.learn_steps)

    save_dir = Path("_ddpg_smoke_ckpt")
    agent.save_models(save_dir)
    agent.load_models(save_dir)
    env.close()


if __name__ == "__main__":
    main()
