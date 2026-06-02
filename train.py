"""
DDPG training pipeline for V2B smart charging (arXiv:2502.18526).

Integrates ``V2BChargingEnv`` and ``DDPGAgent`` with:
  - episode / timestep loops
  - replay-buffer learning
  - metric tracking and matplotlib reward curves
  - best-model checkpointing and periodic evaluation
"""

from __future__ import annotations

import argparse
import json
import logging
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import numpy as np
from tqdm import tqdm

from agents.ddpg_agent import DDPGAgent, DDPGConfig
from rl_env.ev_env import V2BEnvConfig, make_v2b_env

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parent
DEFAULT_LOG_DIR = PROJECT_ROOT / "logs"
DEFAULT_CKPT_DIR = PROJECT_ROOT / "checkpoints"


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


@dataclass
class TrainConfig:
    """End-to-end training hyperparameters."""

    # Environment
    num_chargers: int = 8
    episode_slots: int = 24
    dataset_path: str = str(PROJECT_ROOT / "data" / "processed_ev_data.csv")
    env_seed: int = 42

    # Training schedule
    total_episodes: int = 500
    eval_every: int = 25
    eval_episodes: int = 5
    save_every: int = 50
    log_every: int = 1

    # DDPG (passed to agent)
    gamma: float = 0.99
    tau: float = 0.005
    lr_actor: float = 1e-4
    lr_critic: float = 1e-3
    buffer_capacity: int = 100_000
    batch_size: int = 64
    warmup_steps: int = 1000
    learn_every: int = 1
    ou_sigma: float = 0.2
    noise_decay: float = 0.995
    device: str = "auto"  # "auto" | "cpu" | "cuda"

    # Paths
    log_dir: Path = field(default_factory=lambda: DEFAULT_LOG_DIR)
    checkpoint_dir: Path = field(default_factory=lambda: DEFAULT_CKPT_DIR)
    run_name: str = ""

    seed: int = 42

    def resolve_device(self) -> str:
        if self.device == "auto":
            import torch

            return "cuda" if torch.cuda.is_available() else "cpu"
        return self.device

    def run_dir(self) -> Path:
        name = self.run_name or time.strftime("%Y%m%d_%H%M%S")
        return self.checkpoint_dir / name


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------


@dataclass
class EpisodeMetrics:
    """Aggregated statistics for one episode."""

    episode_reward: float = 0.0
    episode_length: int = 0
    electricity_cost_usd: float = 0.0
    peak_demand_kw: float = 0.0
    renewable_utilization: float = 0.0
    battery_degradation: float = 0.0
    charging_satisfaction: float = 0.0
    mean_critic_loss: float = 0.0
    mean_actor_loss: float = 0.0

    def to_dict(self) -> dict[str, float | int]:
        return asdict(self)


@dataclass
class TrainingHistory:
    """Time series over training episodes."""

    episode_rewards: list[float] = field(default_factory=list)
    electricity_costs: list[float] = field(default_factory=list)
    peak_demands: list[float] = field(default_factory=list)
    renewable_utils: list[float] = field(default_factory=list)
    battery_degradations: list[float] = field(default_factory=list)
    charging_satisfactions: list[float] = field(default_factory=list)
    critic_losses: list[float] = field(default_factory=list)
    actor_losses: list[float] = field(default_factory=list)
    eval_rewards: list[float] = field(default_factory=list)
    eval_episodes: list[int] = field(default_factory=list)

    def append(self, ep: EpisodeMetrics) -> None:
        self.episode_rewards.append(ep.episode_reward)
        self.electricity_costs.append(ep.electricity_cost_usd)
        self.peak_demands.append(ep.peak_demand_kw)
        self.renewable_utils.append(ep.renewable_utilization)
        self.battery_degradations.append(ep.battery_degradation)
        self.charging_satisfactions.append(ep.charging_satisfaction)
        self.critic_losses.append(ep.mean_critic_loss)
        self.actor_losses.append(ep.mean_actor_loss)

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as f:
            json.dump(asdict(self), f, indent=2)

    @classmethod
    def load(cls, path: Path) -> TrainingHistory:
        with path.open(encoding="utf-8") as f:
            data = json.load(f)
        return cls(**data)


def _extract_charging_satisfaction(info: dict[str, Any]) -> float:
    """Pull charging satisfaction from env reward breakdown."""
    bd = info.get("reward_breakdown")
    if not isinstance(bd, dict):
        return 0.0
    if "charging_satisfaction" in bd:
        return float(bd["charging_satisfaction"])
    weighted = bd.get("weighted", {})
    if isinstance(weighted, dict):
        return float(weighted.get("charging_satisfaction", 0.0))
    return 0.0


def run_training_episode(
    agent: DDPGAgent,
    env: Any,
    *,
    explore: bool = True,
) -> EpisodeMetrics:
    """
    Single training episode: reset → interact → store → learn.

    Follows the required flow:
      reset → select action (+ OU noise) → step → replay → train.
    """
    state, _ = env.reset()
    agent.reset_noise()

    ep = EpisodeMetrics()
    critic_losses: list[float] = []
    actor_losses: list[float] = []
    renew_samples: list[float] = []
    deg_samples: list[float] = []
    sat_samples: list[float] = []

    while True:
        action = agent.select_action(state, explore=explore)
        next_state, reward, terminated, truncated, info = env.step(action)
        done = bool(terminated or truncated)

        agent.replay_buffer.add(state, action, float(reward), next_state, done)
        agent.total_steps += 1

        train_metrics: dict[str, float] = {}
        if agent.total_steps >= agent.config.warmup_steps and agent.replay_buffer.is_ready:
            if agent.total_steps % agent.config.learn_every == 0:
                train_metrics = agent.learn().to_dict()
                if explore and agent.config.noise_decay < 1.0:
                    agent.noise.decay_sigma(
                        agent.config.noise_decay,
                        agent.config.min_noise_sigma,
                    )

        ep.episode_reward += float(reward)
        ep.episode_length += 1

        renew_samples.append(float(info.get("renewable_utilization", 0.0)))
        deg_samples.append(float(info.get("battery_degradation", 0.0)))
        sat_samples.append(_extract_charging_satisfaction(info))

        if train_metrics:
            critic_losses.append(train_metrics.get("critic_loss", 0.0))
            actor_losses.append(train_metrics.get("actor_loss", 0.0))

        state = np.asarray(next_state, dtype=np.float32)
        if done:
            break

    ep.electricity_cost_usd = float(
        info.get("electricity_cost_cumulative_usd", 0.0)
    )
    ep.peak_demand_kw = float(info.get("peak_demand", info.get("estimated_peak_power_kw", 0.0)))
    ep.renewable_utilization = float(np.mean(renew_samples)) if renew_samples else 0.0
    ep.battery_degradation = float(np.mean(deg_samples)) if deg_samples else 0.0
    ep.charging_satisfaction = float(np.mean(sat_samples)) if sat_samples else 0.0
    ep.mean_critic_loss = float(np.mean(critic_losses)) if critic_losses else 0.0
    ep.mean_actor_loss = float(np.mean(actor_losses)) if actor_losses else 0.0

    return ep


def run_evaluation(
    agent: DDPGAgent,
    env: Any,
    *,
    n_episodes: int = 5,
) -> dict[str, float]:
    """Deterministic evaluation rollouts (no exploration noise)."""
    agent.set_eval_mode()
    returns: list[float] = []
    peaks: list[float] = []
    costs: list[float] = []

    for _ in range(n_episodes):
        ep = run_training_episode(agent, env, explore=False)
        returns.append(ep.episode_reward)
        peaks.append(ep.peak_demand_kw)
        costs.append(ep.electricity_cost_usd)

    agent.set_train_mode()
    return {
        "eval_mean_reward": float(np.mean(returns)),
        "eval_std_reward": float(np.std(returns)),
        "eval_mean_peak_kw": float(np.mean(peaks)),
        "eval_mean_cost_usd": float(np.mean(costs)),
    }


def plot_training_curves(history: TrainingHistory, save_path: Path) -> None:
    """Save multi-panel training diagnostics figure."""
    save_path.parent.mkdir(parents=True, exist_ok=True)
    episodes = np.arange(1, len(history.episode_rewards) + 1)

    fig, axes = plt.subplots(2, 3, figsize=(14, 8))
    fig.suptitle("V2B DDPG Training Metrics", fontsize=14)

    axes[0, 0].plot(episodes, history.episode_rewards, alpha=0.4, label="episode")
    if len(history.episode_rewards) >= 10:
        w = min(20, len(history.episode_rewards))
        ma = np.convolve(history.episode_rewards, np.ones(w) / w, mode="valid")
        axes[0, 0].plot(np.arange(w, len(history.episode_rewards) + 1), ma, "r-", label=f"MA-{w}")
    axes[0, 0].set_title("Episode Reward")
    axes[0, 0].legend(fontsize=8)

    axes[0, 1].plot(episodes, history.electricity_costs)
    axes[0, 1].set_title("Electricity Cost (USD)")

    axes[0, 2].plot(episodes, history.peak_demands)
    axes[0, 2].set_title("Peak Demand (kW)")

    axes[1, 0].plot(episodes, history.renewable_utils)
    axes[1, 0].set_title("Renewable Utilization")

    axes[1, 1].plot(episodes, history.battery_degradations)
    axes[1, 1].set_title("Battery Degradation")

    axes[1, 2].plot(episodes, history.charging_satisfactions)
    axes[1, 2].set_title("Charging Satisfaction")

    if history.eval_rewards:
        for ep_idx, ev_r in zip(history.eval_episodes, history.eval_rewards):
            axes[0, 0].scatter([ep_idx], [ev_r], c="green", s=40, zorder=5)

    for ax in axes.flat:
        ax.set_xlabel("Episode")
        ax.grid(True, alpha=0.3)

    plt.tight_layout()
    fig.savefig(save_path, dpi=150)
    plt.close(fig)
    logger.info("Saved training plot → %s", save_path)


# ---------------------------------------------------------------------------
# Training orchestration
# ---------------------------------------------------------------------------


def build_env_and_agent(cfg: TrainConfig) -> tuple[Any, DDPGAgent]:
    """Initialize Gymnasium environment and DDPG agent."""
    env_cfg = V2BEnvConfig(
        num_chargers=cfg.num_chargers,
        episode_slots=cfg.episode_slots,
        dataset_path=cfg.dataset_path,
        seed=cfg.env_seed,
    )
    env = make_v2b_env(env_cfg)

    ddpg_cfg = DDPGConfig(
        gamma=cfg.gamma,
        tau=cfg.tau,
        lr_actor=cfg.lr_actor,
        lr_critic=cfg.lr_critic,
        buffer_capacity=cfg.buffer_capacity,
        batch_size=cfg.batch_size,
        warmup_steps=cfg.warmup_steps,
        learn_every=cfg.learn_every,
        ou_sigma=cfg.ou_sigma,
        noise_decay=cfg.noise_decay,
        seed=cfg.seed,
        device=cfg.resolve_device(),
    )

    agent = DDPGAgent.from_gym_env(env, config=ddpg_cfg, device=ddpg_cfg.device)
    return env, agent


def train(cfg: TrainConfig) -> TrainingHistory:
    """
    Main training loop with logging, evaluation, and checkpointing.

    Saves:
      - ``checkpoints/<run>/best/`` — best eval reward
      - ``checkpoints/<run>/latest/`` — periodic snapshots
      - ``logs/<run>/training_metrics.json``
      - ``logs/<run>/reward_curve.png``
    """
    cfg.log_dir.mkdir(parents=True, exist_ok=True)
    run_ckpt = cfg.run_dir()
    best_dir = run_ckpt / "best"
    latest_dir = run_ckpt / "latest"
    log_run = cfg.log_dir / (cfg.run_name or run_ckpt.name)

    env, agent = build_env_and_agent(cfg)
    history = TrainingHistory()
    best_eval_reward = -np.inf

    logger.info(
        "Training V2B DDPG | device=%s | episodes=%d | chargers=%d | slots=%d",
        agent.device,
        cfg.total_episodes,
        cfg.num_chargers,
        cfg.episode_slots,
    )

    pbar = tqdm(range(1, cfg.total_episodes + 1), desc="Training", unit="ep")
    for episode in pbar:
        ep_metrics = run_training_episode(agent, env, explore=True)
        history.append(ep_metrics)

        pbar.set_postfix(
            reward=f"{ep_metrics.episode_reward:.2f}",
            peak=f"{ep_metrics.peak_demand_kw:.0f}",
            buf=len(agent.replay_buffer),
        )

        if episode % cfg.log_every == 0:
            logger.debug(
                "Ep %d | R=%.3f | cost=%.2f | peak=%.1f | renew=%.3f | sat=%.3f",
                episode,
                ep_metrics.episode_reward,
                ep_metrics.electricity_cost_usd,
                ep_metrics.peak_demand_kw,
                ep_metrics.renewable_utilization,
                ep_metrics.charging_satisfaction,
            )

        if episode % cfg.save_every == 0 or episode == cfg.total_episodes:
            agent.save_models(latest_dir)
            history.save(log_run / "training_metrics.json")
            plot_training_curves(history, log_run / "reward_curve.png")

        if episode % cfg.eval_every == 0 or episode == cfg.total_episodes:
            eval_stats = run_evaluation(agent, env, n_episodes=cfg.eval_episodes)
            history.eval_rewards.append(eval_stats["eval_mean_reward"])
            history.eval_episodes.append(episode)

            logger.info(
                "Eval @ ep %d | mean_reward=%.3f ± %.3f | peak=%.1f kW",
                episode,
                eval_stats["eval_mean_reward"],
                eval_stats["eval_std_reward"],
                eval_stats["eval_mean_peak_kw"],
            )

            if eval_stats["eval_mean_reward"] > best_eval_reward:
                best_eval_reward = eval_stats["eval_mean_reward"]
                agent.save_models(best_dir)
                logger.info("New best model saved (eval_reward=%.3f)", best_eval_reward)

    # Final artifacts
    history.save(log_run / "training_metrics.json")
    plot_training_curves(history, log_run / "reward_curve.png")
    agent.save_models(run_ckpt / "final")

    with (log_run / "train_config.json").open("w", encoding="utf-8") as f:
        json.dump(_config_to_json(cfg), f, indent=2)

    env.close()
    logger.info("Training complete. Best eval reward: %.3f", best_eval_reward)
    return history


def _config_to_json(cfg: TrainConfig) -> dict[str, Any]:
    d = asdict(cfg)
    d["log_dir"] = str(cfg.log_dir)
    d["checkpoint_dir"] = str(cfg.checkpoint_dir)
    return d


def parse_args() -> TrainConfig:
    parser = argparse.ArgumentParser(description="Train V2B DDPG smart charging agent")
    parser.add_argument("--episodes", type=int, default=500)
    parser.add_argument("--chargers", type=int, default=8)
    parser.add_argument("--slots", type=int, default=24)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--warmup", type=int, default=1000)
    parser.add_argument("--buffer-size", type=int, default=100_000)
    parser.add_argument("--eval-every", type=int, default=25)
    parser.add_argument("--save-every", type=int, default=50)
    parser.add_argument("--device", type=str, default="auto")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--run-name", type=str, default="")
    parser.add_argument("--quick", action="store_true", help="Short smoke training run")
    args = parser.parse_args()

    cfg = TrainConfig(
        total_episodes=args.episodes,
        num_chargers=args.chargers,
        episode_slots=args.slots,
        batch_size=args.batch_size,
        warmup_steps=args.warmup,
        buffer_capacity=args.buffer_size,
        eval_every=args.eval_every,
        save_every=args.save_every,
        device=args.device,
        seed=args.seed,
        run_name=args.run_name,
    )

    if args.quick:
        cfg.total_episodes = 30
        cfg.warmup_steps = 100
        cfg.eval_every = 10
        cfg.save_every = 15
        cfg.eval_episodes = 2
        cfg.run_name = cfg.run_name or "quick_test"

    return cfg


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(message)s",
        datefmt="%H:%M:%S",
    )
    cfg = parse_args()
    if not cfg.run_name:
        cfg.run_name = time.strftime("%Y%m%d_%H%M%S")
    train(cfg)


if __name__ == "__main__":
    main()
