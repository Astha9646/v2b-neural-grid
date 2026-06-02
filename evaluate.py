"""
Evaluation pipeline for V2B DDPG smart charging (arXiv:2502.18526).

Loads trained checkpoints, runs deterministic policy rollouts (no OU noise),
aggregates smart-grid metrics, and saves comparison plots vs a random baseline.
"""

from __future__ import annotations

import argparse
import json
import logging
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import torch
from tqdm import tqdm

from agents.ddpg_agent import DDPGAgent, DDPGConfig
from rl_env.ev_env import V2BEnvConfig, make_v2b_env

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parent
DEFAULT_CKPT = PROJECT_ROOT / "checkpoints" / "quick_test" / "best"
DEFAULT_OUTPUT = PROJECT_ROOT / "evaluation"


# ---------------------------------------------------------------------------
# Configuration & data structures
# ---------------------------------------------------------------------------


@dataclass
class EvalConfig:
    """Evaluation run settings."""

    checkpoint_dir: Path = field(default_factory=lambda: DEFAULT_CKPT)
    output_dir: Path = field(default_factory=lambda: DEFAULT_OUTPUT)
    num_episodes: int = 20
    num_chargers: int = 8
    episode_slots: int = 24
    dataset_path: str = str(PROJECT_ROOT / "data" / "processed_ev_data.csv")
    env_seed: int = 123
    device: str = "auto"
    run_baseline: bool = True
    baseline_episodes: int | None = None  # None → same as num_episodes
    seed: int = 123


@dataclass
class EpisodeMetrics:
    """Per-episode aggregated metrics."""

    policy: str
    episode_id: int
    episode_reward: float
    episode_length: int
    electricity_cost_usd: float
    peak_demand_kw: float
    renewable_utilization: float
    charging_satisfaction: float
    battery_degradation: float
    mean_net_power_kw: float = 0.0


@dataclass
class EpisodeTrace:
    """Time-series logged during one episode (for plots)."""

    slots: list[int] = field(default_factory=list)
    rewards: list[float] = field(default_factory=list)
    cumulative_reward: list[float] = field(default_factory=list)
    net_power_kw: list[float] = field(default_factory=list)
    building_load_kw: list[float] = field(default_factory=list)
    peak_demand_kw: list[float] = field(default_factory=list)
    mean_soc: list[float] = field(default_factory=list)
    total_charge_kw: list[float] = field(default_factory=list)
    renewable_util: list[float] = field(default_factory=list)
    battery_degradation: list[float] = field(default_factory=list)


@dataclass
class EvalResult:
    """Full evaluation output."""

    policy_name: str
    episodes: list[EpisodeMetrics] = field(default_factory=list)
    representative_trace: EpisodeTrace | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _resolve_device(device: str) -> str:
    if device == "auto":
        return "cuda" if torch.cuda.is_available() else "cpu"
    return device


def _extract_charging_satisfaction(info: dict[str, Any]) -> float:
    bd = info.get("reward_breakdown")
    if not isinstance(bd, dict):
        return 0.0
    if "charging_satisfaction" in bd:
        return float(bd["charging_satisfaction"])
    weighted = bd.get("weighted", {})
    if isinstance(weighted, dict):
        return float(weighted.get("charging_satisfaction", 0.0))
    return 0.0


def _mean_soc_from_info(info: dict[str, Any]) -> float:
    stats = info.get("soc_statistics", {})
    if isinstance(stats, dict) and stats.get("mean") is not None:
        return float(stats["mean"])
    soc = info.get("soc_current")
    if isinstance(soc, list) and soc:
        connected = info.get("connected", [True] * len(soc))
        vals = [float(s) for s, c in zip(soc, connected) if c]
        return float(np.mean(vals)) if vals else 0.5
    return 0.5


def _total_charge_kw_from_info(info: dict[str, Any]) -> float:
    masked = info.get("masked_action")
    if masked is None:
        masked = info.get("raw_action")
    if isinstance(masked, list):
        return float(sum(max(0.0, float(x)) for x in masked))
    return 0.0


def build_env(cfg: EvalConfig) -> Any:
    env_cfg = V2BEnvConfig(
        num_chargers=cfg.num_chargers,
        episode_slots=cfg.episode_slots,
        dataset_path=cfg.dataset_path,
        seed=cfg.env_seed,
    )
    return make_v2b_env(env_cfg)


def load_agent(env: Any, checkpoint_dir: Path, device: str) -> DDPGAgent:
    """Load trained Actor/Critic weights from ``train.py`` checkpoints."""
    checkpoint_dir = Path(checkpoint_dir)
    if not (checkpoint_dir / "actor.pt").exists():
        raise FileNotFoundError(f"No actor.pt in {checkpoint_dir}")

    meta: dict[str, Any] = {}
    meta_path = checkpoint_dir / "meta.pt"
    if meta_path.exists():
        meta = torch.load(meta_path, map_location="cpu", weights_only=True)
        saved_cfg = meta.get("config", {})
        ddpg_cfg = DDPGConfig(
            state_dim=int(saved_cfg.get("state_dim", env.observation_space.shape[0])),
            action_dim=int(saved_cfg.get("action_dim", env.action_space.shape[0])),
            device=device,
        )
    else:
        ddpg_cfg = DDPGConfig(device=device)

    agent = DDPGAgent.from_gym_env(env, config=ddpg_cfg, device=device)
    agent.load_models(checkpoint_dir, load_optimizers=False)
    agent.set_eval_mode()
    return agent


# ---------------------------------------------------------------------------
# Rollout loops
# ---------------------------------------------------------------------------


def run_eval_episode(
    env: Any,
    *,
    policy: str,
    episode_id: int,
    agent: DDPGAgent | None = None,
    record_trace: bool = False,
) -> tuple[EpisodeMetrics, EpisodeTrace | None]:
    """
    One evaluation episode without exploration noise.

    Parameters
    ----------
    policy:
        ``"ddpg"`` uses ``agent.select_action(..., explore=False)``;
        ``"random"`` samples Uniform[-1, 1] actions.
    """
    state, _ = env.reset()
    trace = EpisodeTrace() if record_trace else None

    ep_reward = 0.0
    length = 0
    renew_samples: list[float] = []
    deg_samples: list[float] = []
    sat_samples: list[float] = []
    net_samples: list[float] = []
    last_info: dict[str, Any] = {}

    while True:
        if policy == "ddpg":
            if agent is None:
                raise ValueError("agent required for ddpg policy")
            action = agent.select_action(state, explore=False)
        elif policy == "random":
            action = env.action_space.sample().astype(np.float32)
        else:
            raise ValueError(f"Unknown policy: {policy}")

        next_state, reward, terminated, truncated, info = env.step(action)
        done = bool(terminated or truncated)
        ep_reward += float(reward)
        length += 1
        last_info = info

        renew_samples.append(float(info.get("renewable_utilization", 0.0)))
        deg_samples.append(float(info.get("battery_degradation", 0.0)))
        sat_samples.append(_extract_charging_satisfaction(info))
        net_samples.append(float(info.get("net_power_kw", info.get("building_load_kw", 0.0))))

        if trace is not None:
            trace.slots.append(int(info.get("slot", length)))
            trace.rewards.append(float(reward))
            trace.cumulative_reward.append(ep_reward)
            trace.net_power_kw.append(float(info.get("net_power_kw", 0.0)))
            trace.building_load_kw.append(float(info.get("building_load_kw", 0.0)))
            trace.peak_demand_kw.append(float(info.get("peak_demand", 0.0)))
            trace.mean_soc.append(_mean_soc_from_info(info))
            trace.total_charge_kw.append(_total_charge_kw_from_info(info))
            trace.renewable_util.append(float(info.get("renewable_utilization", 0.0)))
            trace.battery_degradation.append(float(info.get("battery_degradation", 0.0)))

        state = np.asarray(next_state, dtype=np.float32)
        if done:
            break

    metrics = EpisodeMetrics(
        policy=policy,
        episode_id=episode_id,
        episode_reward=ep_reward,
        episode_length=length,
        electricity_cost_usd=float(last_info.get("electricity_cost_cumulative_usd", 0.0)),
        peak_demand_kw=float(
            last_info.get("peak_demand", last_info.get("estimated_peak_power_kw", 0.0))
        ),
        renewable_utilization=float(np.mean(renew_samples)) if renew_samples else 0.0,
        charging_satisfaction=float(np.mean(sat_samples)) if sat_samples else 0.0,
        battery_degradation=float(np.mean(deg_samples)) if deg_samples else 0.0,
        mean_net_power_kw=float(np.mean(net_samples)) if net_samples else 0.0,
    )
    return metrics, trace


def evaluate_policy(
    env: Any,
    agent: DDPGAgent | None,
    *,
    policy: str,
    n_episodes: int,
    desc: str,
) -> EvalResult:
    """Run ``n_episodes`` and return metrics + trace from first episode."""
    episodes: list[EpisodeMetrics] = []
    rep_trace: EpisodeTrace | None = None

    for ep_id in tqdm(range(n_episodes), desc=desc, unit="ep"):
        record = ep_id == 0
        metrics, trace = run_eval_episode(
            env,
            policy=policy,
            episode_id=ep_id,
            agent=agent,
            record_trace=record,
        )
        episodes.append(metrics)
        if record:
            rep_trace = trace

    return EvalResult(policy_name=policy, episodes=episodes, representative_trace=rep_trace)


# ---------------------------------------------------------------------------
# Aggregation & summary
# ---------------------------------------------------------------------------


def episodes_to_dataframe(results: list[EvalResult]) -> pd.DataFrame:
    rows = []
    for res in results:
        for ep in res.episodes:
            rows.append(asdict(ep))
    return pd.DataFrame(rows)


def compute_summary(df: pd.DataFrame) -> pd.DataFrame:
    """Mean/std per policy for all numeric metrics."""
    numeric = [
        "episode_reward",
        "electricity_cost_usd",
        "peak_demand_kw",
        "renewable_utilization",
        "charging_satisfaction",
        "battery_degradation",
        "mean_net_power_kw",
    ]
    agg = df.groupby("policy")[numeric].agg(["mean", "std", "min", "max"])
    return agg


def compute_reductions(summary: pd.DataFrame, baseline: str = "random", policy: str = "ddpg") -> dict[str, float]:
    """
  Reduction vs baseline (positive % = improvement for costs/peaks).

  - Cost / peak: lower is better → reduction = (base - policy) / base * 100
  - Reward / renewable / satisfaction: higher is better
    """
    out: dict[str, float] = {}

    def _get(pol: str, metric: str, stat: str = "mean") -> float:
        try:
            return float(summary.loc[pol, (metric, stat)])
        except KeyError:
            return 0.0

    base_cost = _get(baseline, "electricity_cost_usd")
    pol_cost = _get(policy, "electricity_cost_usd")
    if base_cost > 0:
        out["electricity_cost_reduction_pct"] = (base_cost - pol_cost) / base_cost * 100.0

    base_peak = _get(baseline, "peak_demand_kw")
    pol_peak = _get(policy, "peak_demand_kw")
    if base_peak > 0:
        out["peak_demand_reduction_pct"] = (base_peak - pol_peak) / base_peak * 100.0

    base_r = _get(baseline, "episode_reward")
    pol_r = _get(policy, "episode_reward")
    if abs(base_r) > 1e-6:
        out["reward_improvement_pct"] = (pol_r - base_r) / abs(base_r) * 100.0
    else:
        out["reward_improvement_pct"] = pol_r - base_r

    out["renewable_utilization_gain"] = _get(policy, "renewable_utilization") - _get(
        baseline, "renewable_utilization"
    )
    out["charging_satisfaction_gain"] = _get(policy, "charging_satisfaction") - _get(
        baseline, "charging_satisfaction"
    )
    out["battery_degradation_delta"] = _get(policy, "battery_degradation") - _get(
        baseline, "battery_degradation"
    )

    out["ddpg_mean_reward"] = pol_r
    out["baseline_mean_reward"] = base_r
    return out


# ---------------------------------------------------------------------------
# Visualizations
# ---------------------------------------------------------------------------


def plot_episode_rewards(df: pd.DataFrame, path: Path) -> None:
    """Distribution / per-episode rewards by policy."""
    fig, ax = plt.subplots(figsize=(8, 5))
    for policy in df["policy"].unique():
        sub = df[df["policy"] == policy]
        ax.plot(sub["episode_id"], sub["episode_reward"], "o-", alpha=0.7, label=policy)
    ax.set_xlabel("Episode")
    ax.set_ylabel("Episode Reward")
    ax.set_title("Evaluation Episode Rewards")
    ax.legend()
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def plot_comparison_bars(summary: pd.DataFrame, path: Path) -> None:
    """Bar chart comparing mean metrics across policies."""
    metrics = [
        "episode_reward",
        "electricity_cost_usd",
        "peak_demand_kw",
        "renewable_utilization",
        "charging_satisfaction",
    ]
    policies = list(summary.index)
    x = np.arange(len(metrics))
    width = 0.8 / max(len(policies), 1)

    fig, ax = plt.subplots(figsize=(10, 6))
    for i, pol in enumerate(policies):
        means = [float(summary.loc[pol, (m, "mean")]) for m in metrics]
        offset = (i - len(policies) / 2 + 0.5) * width
        ax.bar(x + offset, means, width, label=pol)

    ax.set_xticks(x)
    ax.set_xticklabels(metrics, rotation=25, ha="right")
    ax.set_title("Policy Comparison (mean evaluation metrics)")
    ax.legend()
    ax.grid(True, axis="y", alpha=0.3)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def plot_peak_load(trace: EpisodeTrace, path: Path) -> None:
    """Net and building power vs time slot."""
    fig, ax = plt.subplots(figsize=(9, 5))
    slots = trace.slots
    ax.plot(slots, trace.net_power_kw, "r-", linewidth=2, label="Net power (B + EV)")
    ax.plot(slots, trace.building_load_kw, "b--", alpha=0.8, label="Building load B")
    ax.plot(slots, trace.peak_demand_kw, "g:", alpha=0.9, label="Running peak estimate")
    ax.set_xlabel("Time slot T_j")
    ax.set_ylabel("Power (kW)")
    ax.set_title("Peak Load Profile (DDPG policy)")
    ax.legend()
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def plot_soc_tracking(trace: EpisodeTrace, path: Path) -> None:
    """Mean fleet SOC over the episode."""
    fig, ax = plt.subplots(figsize=(9, 4))
    ax.plot(trace.slots, trace.mean_soc, "m-o", markersize=4)
    ax.axhline(0.9, color="gray", linestyle="--", alpha=0.5, label="Typical target (~0.9)")
    ax.set_xlabel("Time slot T_j")
    ax.set_ylabel("Mean SOC (normalized)")
    ax.set_ylim(0.0, 1.05)
    ax.set_title("SOC Tracking (connected EVs)")
    ax.legend()
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def plot_charging_behavior(trace: EpisodeTrace, path: Path) -> None:
    """Aggregate charging power and step rewards."""
    fig, axes = plt.subplots(2, 1, figsize=(9, 7), sharex=True)

    axes[0].bar(trace.slots, trace.total_charge_kw, color="steelblue", alpha=0.8)
    axes[0].set_ylabel("Σ max(P, 0) per slot (kW)")
    axes[0].set_title("Charging Power by Time Slot")
    axes[0].grid(True, alpha=0.3)

    axes[1].plot(trace.slots, trace.cumulative_reward, "k-", linewidth=2)
    axes[1].set_xlabel("Time slot T_j")
    axes[1].set_ylabel("Cumulative reward")
    axes[1].set_title("Reward Accumulation")
    axes[1].grid(True, alpha=0.3)

    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def plot_reward_curve_comparison(ddpg_df: pd.DataFrame, baseline_df: pd.DataFrame | None, path: Path) -> None:
    """Overlaid cumulative-style comparison."""
    fig, ax = plt.subplots(figsize=(8, 5))
    ax.plot(ddpg_df["episode_id"], ddpg_df["episode_reward"], "o-", label="DDPG", color="C0")
    if baseline_df is not None:
        ax.plot(
            baseline_df["episode_id"],
            baseline_df["episode_reward"],
            "s--",
            label="Random baseline",
            color="C1",
            alpha=0.8,
        )
    ax.set_xlabel("Evaluation episode")
    ax.set_ylabel("Episode reward")
    ax.set_title("DDPG vs Baseline — Episode Rewards")
    ax.legend()
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def generate_all_plots(
    ddpg_result: EvalResult,
    baseline_result: EvalResult | None,
    df: pd.DataFrame,
    summary: pd.DataFrame,
    output_dir: Path,
) -> None:
    """Write all evaluation figures."""
    fig_dir = output_dir / "figures"
    fig_dir.mkdir(parents=True, exist_ok=True)

    plot_episode_rewards(df, fig_dir / "episode_rewards_by_policy.png")

    ddpg_df = df[df["policy"] == "ddpg"]
    base_df = df[df["policy"] == "random"] if "random" in df["policy"].values else None
    plot_reward_curve_comparison(ddpg_df, base_df, fig_dir / "reward_comparison.png")
    plot_comparison_bars(summary, fig_dir / "metric_comparison_bars.png")

    if ddpg_result.representative_trace is not None:
        tr = ddpg_result.representative_trace
        plot_peak_load(tr, fig_dir / "peak_load_profile.png")
        plot_soc_tracking(tr, fig_dir / "soc_tracking.png")
        plot_charging_behavior(tr, fig_dir / "charging_behavior.png")


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------


def run_evaluation(cfg: EvalConfig) -> dict[str, Any]:
    """Full evaluation: load model → rollouts → metrics → plots → save."""
    cfg.output_dir.mkdir(parents=True, exist_ok=True)
    device = _resolve_device(cfg.device)

    env = build_env(cfg)
    agent = load_agent(env, cfg.checkpoint_dir, device)

    logger.info("Evaluating DDPG policy (%d episodes, no exploration)", cfg.num_episodes)
    ddpg_result = evaluate_policy(env, agent, policy="ddpg", n_episodes=cfg.num_episodes, desc="DDPG eval")

    results: list[EvalResult] = [ddpg_result]
    baseline_result = None
    if cfg.run_baseline:
        n_base = cfg.baseline_episodes or cfg.num_episodes
        logger.info("Evaluating random baseline (%d episodes)", n_base)
        baseline_result = evaluate_policy(
            env, None, policy="random", n_episodes=n_base, desc="Baseline eval"
        )
        results.append(baseline_result)

    df = episodes_to_dataframe(results)
    summary = compute_summary(df)

    reductions: dict[str, float] = {}
    if baseline_result is not None:
        reductions = compute_reductions(summary, baseline="random", policy="ddpg")

    # Save tables
    df.to_csv(cfg.output_dir / "episode_metrics.csv", index=False)
    summary.to_csv(cfg.output_dir / "summary_statistics.csv")

    # Flatten multi-index summary for JSON
    summary_flat: dict[str, dict[str, float]] = {}
    for pol in summary.index:
        summary_flat[str(pol)] = {
            f"{metric}_{stat}": float(summary.loc[pol, (metric, stat)])
            for metric in summary.columns.get_level_values(0).unique()
            for stat in ("mean", "std", "min", "max")
            if (metric, stat) in summary.columns
        }

    report = {
        "checkpoint": str(cfg.checkpoint_dir),
        "num_episodes": cfg.num_episodes,
        "device": device,
        "summary": summary_flat,
        "reductions_vs_random": reductions,
    }
    with (cfg.output_dir / "evaluation_report.json").open("w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, default=str)

    generate_all_plots(ddpg_result, baseline_result, df, summary, cfg.output_dir)

    # Console summary
    print("\n=== Evaluation Summary ===")
    print(summary.to_string())
    if reductions:
        print("\n=== DDPG vs Random Baseline ===")
        for k, v in reductions.items():
            print(f"  {k}: {v:.4f}")

    env.close()
    logger.info("Evaluation artifacts saved → %s", cfg.output_dir)
    return report


def parse_args() -> EvalConfig:
    parser = argparse.ArgumentParser(description="Evaluate V2B DDPG charging policy")
    parser.add_argument("--checkpoint", type=str, default=str(DEFAULT_CKPT))
    parser.add_argument("--output", type=str, default=str(DEFAULT_OUTPUT))
    parser.add_argument("--episodes", type=int, default=20)
    parser.add_argument("--chargers", type=int, default=8)
    parser.add_argument("--slots", type=int, default=24)
    parser.add_argument("--device", type=str, default="auto")
    parser.add_argument("--no-baseline", action="store_true")
    parser.add_argument("--seed", type=int, default=123)
    args = parser.parse_args()

    return EvalConfig(
        checkpoint_dir=Path(args.checkpoint),
        output_dir=Path(args.output),
        num_episodes=args.episodes,
        num_chargers=args.chargers,
        episode_slots=args.slots,
        device=args.device,
        run_baseline=not args.no_baseline,
        env_seed=args.seed,
        seed=args.seed,
    )


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(message)s",
        datefmt="%H:%M:%S",
    )
    cfg = parse_args()
    np.random.seed(cfg.seed)
    run_evaluation(cfg)


if __name__ == "__main__":
    main()
