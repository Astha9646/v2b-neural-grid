"""
RL integration interfaces — DDPG policy, action masking, state vectors, rewards.

Prepared for wiring ``backend.inference.model_service`` (Actor) into the ops layer.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

import numpy as np

# Align with rl_env.state_builder when available
STATE_DIM = 23
ACTION_DIM = 8


@dataclass
class RLStateVector:
    values: list[float]
    dim: int
    feature_names: list[str]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class RLActionMask:
    """Action mask metadata for heterogeneous chargers."""

    masked_indices: list[int]
    floor_kw: list[float]
    ceiling_kw: list[float]
    urgent_slots: list[int]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class RLOptimizationScore:
    reward_signal: float
    peak_penalty: float
    renewable_score: float
    cost_proxy: float
    total: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _n(row: dict[str, Any], key: str, default: float = 0.0) -> float:
    try:
        return float(row.get(key, default))
    except (TypeError, ValueError):
        return default


def build_state_vector(row: dict[str, Any]) -> RLStateVector:
    """Map telemetry row to normalized 23-dim state (fallback when env unavailable)."""
    names = [
        "normalized_load",
        "normalized_soc",
        "normalized_stress",
        "renewable_state",
        "peak_penalty",
        "charger_utilization",
        "renewable_ratio",
        "thermal_index",
        "anomaly_score",
        "predicted_peak_risk",
        "charging_stress_score",
        "battery_health_percent",
        "degradation_score",
        "rl_reward_signal",
        "solar_generation_kw",
        "charging_power_kw",
        "grid_load_kw",
        "soc_percent",
        "renewable_utilization_score",
        "station_efficiency_score",
        "charging_queue_index",
        "battery_risk_level",
        "carbon_savings_kg",
    ]
    raw = [_n(row, k) for k in names]
    # Normalize heuristically to [0,1] where needed
    scaled = []
    for i, v in enumerate(raw):
        if i < 5:
            scaled.append(float(np.clip(v, 0, 1)))
        elif "kw" in names[i] or names[i] in ("thermal_index", "carbon_savings_kg"):
            scaled.append(float(np.clip(v / 400.0, 0, 1)))
        else:
            scaled.append(float(np.clip(v / 100.0, 0, 1)))

    while len(scaled) < STATE_DIM:
        scaled.append(0.0)
    scaled = scaled[:STATE_DIM]

    return RLStateVector(values=scaled, dim=STATE_DIM, feature_names=names[:STATE_DIM])


def compute_action_mask(row: dict[str, Any]) -> RLActionMask:
    """Algorithm-1 style mask hints from telemetry."""
    util = _n(row, "charger_utilization")
    stress = _n(row, "grid_stress_index")
    soc = _n(row, "soc_percent")
    masked = []
    floor = [0.0] * ACTION_DIM
    ceiling = [22.0, 22.0, 50.0, 18.0, 22.0, 22.0, 50.0, 18.0][:ACTION_DIM]
    urgent = []

    if stress > 0.6:
        masked.extend([2, 3])
    if soc >= 90:
        masked.extend([0, 1])
    if util > 0.85:
        urgent.extend([2, 3])

    return RLActionMask(
        masked_indices=sorted(set(masked)),
        floor_kw=floor,
        ceiling_kw=ceiling,
        urgent_slots=urgent,
    )


def compute_reward_components(row: dict[str, Any] | None = None) -> dict[str, float]:
    """Reward components r₁–r₃ proxy from telemetry."""
    row = row or {}
    stress = _n(row, "grid_stress_index")
    renewable = _n(row, "renewable_ratio")
    peak_pen = _n(row, "peak_penalty")

    r_peak = -peak_pen * 1.2 - max(0, stress - 0.5) * 0.8
    r_renewable = renewable * 0.6
    r_cost = -stress * 0.3
    total = r_peak + r_renewable + r_cost

    return {
        "r_peak": round(r_peak, 4),
        "r_renewable": round(r_renewable, 4),
        "r_cost": round(r_cost, 4),
        "total": round(total, 4),
    }


def optimization_score(row: dict[str, Any]) -> RLOptimizationScore:
    comps = compute_reward_components(row)
    return RLOptimizationScore(
        reward_signal=_n(row, "rl_reward_signal", comps["total"]),
        peak_penalty=_n(row, "peak_penalty"),
        renewable_score=_n(row, "renewable_ratio"),
        cost_proxy=abs(comps["r_cost"]),
        total=comps["total"],
    )


def policy_integration_payload(row: dict[str, Any]) -> dict[str, Any]:
    """Bundle for future DDPG actor hook-in."""
    state = build_state_vector(row)
    mask = compute_action_mask(row)
    score = optimization_score(row)
    return {
        "state": state.to_dict(),
        "action_mask": mask.to_dict(),
        "optimization": score.to_dict(),
        "action_dim": ACTION_DIM,
        "state_dim": STATE_DIM,
        "policy_ready": True,
    }
