#!/usr/bin/env python3
"""
Train DDPG on ``data/grid_telemetry.csv`` for V2B Neural Grid optimization.

Usage (from project root):
  python -m backend.rl.train_ddpg
  python -m backend.rl.train_ddpg --episodes 300 --device cpu
"""

from __future__ import annotations

import argparse
import csv
import logging
import sys
from pathlib import Path

import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.rl.ddpg_agent import TelemetryDDPGAgent
from backend.rl.env import make_telemetry_env
from backend.rl.rl_config import RLConfig, default_config, resolve_device

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("train_ddpg")


def append_metrics_row(path: Path, row: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    write_header = not path.is_file()
    with path.open("a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(row.keys()))
        if write_header:
            writer.writeheader()
        writer.writerow(row)


def evaluate_policy(agent: TelemetryDDPGAgent, config: RLConfig) -> dict[str, float]:
    env = make_telemetry_env(config, train=False)
    state, _ = env.reset(seed=config.random_seed + 999)
    done = False
    rewards: list[float] = []
    while not done:
        action = agent.select_action(state, explore=False)
        state, reward, term, trunc, info = env.step(action)
        rewards.append(reward)
        done = term or trunc
    ep_metrics = info.get("episode_metrics", {})
    return {
        "eval_episode_reward": float(np.sum(rewards)),
        "eval_renewable_efficiency": ep_metrics.get("renewable_efficiency", 0.0),
        "eval_stress_reduction": ep_metrics.get("stress_reduction", 0.0),
        "eval_battery_protection_score": ep_metrics.get("battery_protection_score", 0.0),
        "eval_peak_reduction": ep_metrics.get("peak_reduction", 0.0),
    }


def train(config: RLConfig) -> TelemetryDDPGAgent:
    config.device = resolve_device(config.device)
    logger.info(
        "Training telemetry DDPG | episodes=%d | device=%s | data=%s",
        config.num_episodes,
        config.device,
        config.telemetry_path,
    )

    if not config.telemetry_path.is_file():
        raise FileNotFoundError(
            f"Telemetry file not found: {config.telemetry_path}. "
            "Run: python data/preprocess.py --mode telemetry"
        )

    env = make_telemetry_env(config, train=True)
    agent = TelemetryDDPGAgent(config)

    if config.metrics_csv_path.is_file():
        config.metrics_csv_path.unlink()

    best_eval = -np.inf

    for episode in range(1, config.num_episodes + 1):
        state, _ = env.reset(seed=config.random_seed + episode)
        done = False
        ep_reward = 0.0
        ep_critic_losses: list[float] = []
        ep_actor_losses: list[float] = []
        steps = 0

        while not done:
            action = agent.select_action(state, explore=True)
            next_state, reward, term, trunc, info = env.step(action)
            done = term or trunc
            agent.store(state, action, reward, next_state, done)
            stats = agent.learn()
            if stats:
                ep_critic_losses.append(stats.critic_loss)
                ep_actor_losses.append(stats.actor_loss)
            state = next_state
            ep_reward += reward
            steps += 1

        agent.decay_noise()
        ep_metrics = info.get("episode_metrics", {})

        row = {
            "episode": episode,
            "steps": steps,
            "episode_reward": round(ep_reward, 4),
            "critic_loss": round(float(np.mean(ep_critic_losses) if ep_critic_losses else 0), 6),
            "actor_loss": round(float(np.mean(ep_actor_losses) if ep_actor_losses else 0), 6),
            "noise_sigma": round(agent.noise_sigma, 5),
            "renewable_efficiency": round(ep_metrics.get("renewable_efficiency", 0), 4),
            "stress_reduction": round(ep_metrics.get("stress_reduction", 0), 4),
            "battery_protection_score": round(ep_metrics.get("battery_protection_score", 0), 4),
            "peak_reduction": round(ep_metrics.get("peak_reduction", 0), 4),
            "total_steps": agent.total_steps,
        }

        if episode % config.eval_every == 0:
            eval_stats = evaluate_policy(agent, config)
            row.update({k: round(v, 4) for k, v in eval_stats.items()})
            if eval_stats["eval_episode_reward"] > best_eval:
                best_eval = eval_stats["eval_episode_reward"]
                agent.save(config.checkpoint_dir)
                logger.info("New best eval reward %.3f — checkpoint saved", best_eval)

        append_metrics_row(config.metrics_csv_path, row)

        if episode % config.save_every == 0:
            agent.save(config.checkpoint_dir)

        if episode % 10 == 0 or episode == 1:
            logger.info(
                "Episode %d/%d | reward=%.2f | renewable=%.2f | stress↓=%.3f | buffer=%d",
                episode,
                config.num_episodes,
                ep_reward,
                ep_metrics.get("renewable_efficiency", 0),
                ep_metrics.get("stress_reduction", 0),
                len(agent.buffer),
            )

    agent.save(config.checkpoint_dir)
    logger.info("Training complete. Metrics: %s", config.metrics_csv_path)
    logger.info("Checkpoints: %s", config.actor_checkpoint)
    return agent


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Train V2B telemetry DDPG")
    p.add_argument("--episodes", type=int, default=None)
    p.add_argument("--batch-size", type=int, default=None)
    p.add_argument("--device", type=str, default=None)
    p.add_argument("--telemetry", type=str, default=None)
    p.add_argument("--seed", type=int, default=None)
    return p.parse_args()


def main() -> None:
    args = parse_args()
    cfg = default_config()
    if args.episodes is not None:
        cfg.num_episodes = args.episodes
    if args.batch_size is not None:
        cfg.batch_size = args.batch_size
    if args.device is not None:
        cfg.device = args.device
    if args.telemetry is not None:
        cfg.telemetry_path = Path(args.telemetry)
    if args.seed is not None:
        cfg.random_seed = args.seed
    train(cfg)


if __name__ == "__main__":
    main()
