"""
Multi-objective reward for V2B telemetry DDPG training.

Objectives:
  + renewable utilization, load balance, low stress, battery protection, peak reduction
  − overload, degradation, thermal spikes, instability, anomalies
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from backend.rl.rl_config import ACTION_NAMES, STATE_FEATURE_NAMES


def _idx(name: str) -> int:
    return STATE_FEATURE_NAMES.index(name)


@dataclass
class RewardBreakdown:
    total: float
    renewable: float
    balance: float
    stress: float
    battery: float
    peak: float
    penalty: float

    def to_dict(self) -> dict[str, float]:
        return {
            "total": self.total,
            "renewable": self.renewable,
            "balance": self.balance,
            "stress": self.stress,
            "battery": self.battery,
            "peak": self.peak,
            "penalty": self.penalty,
        }


def _denorm(state: np.ndarray, caps: dict[str, float]) -> dict[str, float]:
    out: dict[str, float] = {}
    for i, name in enumerate(STATE_FEATURE_NAMES):
        cap = caps.get(name, 1.0) or 1.0
        out[name] = float(state[i]) * cap
    return out


def compute_reward(
    state: np.ndarray,
    action: np.ndarray,
    next_state: np.ndarray,
    *,
    caps: dict[str, float],
    done: bool = False,
) -> tuple[float, RewardBreakdown]:
    """
    Scalar reward for transition (s, a, s').

    ``action`` components in [-1, 1] align with ACTION_NAMES.
    """
    s = _denorm(state, caps)
    ns = _denorm(next_state, caps)
    a = {ACTION_NAMES[i]: float(action[i]) for i in range(len(ACTION_NAMES))}

    # --- Positive components ---
    renewable_gain = 0.35 * ns["renewable_ratio"]
    renewable_action = 0.15 * max(0.0, a["renewable_allocation"])
    renewable = renewable_gain + renewable_action

    load_delta = abs(ns["grid_load_kw"] - s["grid_load_kw"])
    balance = 0.2 * max(0.0, 1.0 - load_delta / 80.0)
    balance += 0.1 * max(0.0, a["load_shift_factor"]) * (1.0 - ns["grid_stress_index"])

    stress_drop = max(0.0, s["grid_stress_index"] - ns["grid_stress_index"])
    stress = 0.25 * stress_drop + 0.1 * (1.0 - ns["grid_stress_index"])

    soc_safe = 1.0 - abs(ns["soc_percent"] - 85.0) / 85.0
    battery = 0.15 * max(0.0, soc_safe)
    battery += 0.2 * max(0.0, a["battery_protection_strength"]) * (
        1.0 - ns["degradation_score"] / 20.0
    )

    peak_relief = max(0.0, s["grid_load_kw"] - ns["grid_load_kw"]) / max(s["grid_load_kw"], 1.0)
    peak = 0.2 * peak_relief + 0.15 * max(0.0, a["peak_shaving_factor"]) * (
        1.0 - ns["grid_stress_index"]
    )

    # --- Penalties ---
    penalty = 0.0
    if ns["grid_stress_index"] > 0.75:
        penalty += 0.35 * (ns["grid_stress_index"] - 0.75)
    if ns["thermal_index"] > 38.0:
        penalty += 0.25 * (ns["thermal_index"] - 38.0) / 12.0
    if ns["degradation_score"] > 6.0:
        penalty += 0.15 * (ns["degradation_score"] - 6.0) / 10.0
    if ns["anomaly_score"] > 1.5:
        penalty += 0.2 * min(ns["anomaly_score"] / 5.0, 1.0)
    if ns["charger_utilization"] > 0.92:
        penalty += 0.2 * (ns["charger_utilization"] - 0.92) / 0.08

    # Misaligned charging under stress
    if ns["grid_stress_index"] > 0.6 and a["charging_rate_adjustment"] > 0.5:
        penalty += 0.15

    total = renewable + balance + stress + battery + peak - penalty
    if done:
        total += 0.05 * max(0.0, ns["renewable_ratio"])

    total = float(np.clip(total, -2.0, 2.0))

    breakdown = RewardBreakdown(
        total=total,
        renewable=float(renewable),
        balance=float(balance),
        stress=float(stress),
        battery=float(battery),
        peak=float(peak),
        penalty=float(penalty),
    )
    return total, breakdown


def episode_metrics(
    states: list[np.ndarray],
    rewards: list[float],
    caps: dict[str, float],
) -> dict[str, float]:
    """Aggregate KPIs for training_metrics.csv."""
    if not states:
        return {
            "renewable_efficiency": 0.0,
            "stress_reduction": 0.0,
            "battery_protection_score": 0.0,
            "peak_reduction": 0.0,
        }

    denormed = [_denorm(s, caps) for s in states]
    renewable = float(np.mean([d["renewable_ratio"] for d in denormed]))
    stress = float(np.mean([d["grid_stress_index"] for d in denormed]))
    stress_start = denormed[0]["grid_stress_index"]
    stress_end = denormed[-1]["grid_stress_index"]
    stress_reduction = max(0.0, stress_start - stress_end)

    soc_dev = float(np.mean([abs(d["soc_percent"] - 85.0) for d in denormed]))
    battery_score = max(0.0, 1.0 - soc_dev / 85.0)

    loads = [d["grid_load_kw"] for d in denormed]
    peak_reduction = max(0.0, max(loads) - min(loads)) if len(loads) > 1 else 0.0

    return {
        "episode_reward": float(np.sum(rewards)),
        "renewable_efficiency": renewable,
        "stress_reduction": stress_reduction,
        "mean_stress": stress,
        "battery_protection_score": battery_score,
        "peak_reduction": peak_reduction,
    }
