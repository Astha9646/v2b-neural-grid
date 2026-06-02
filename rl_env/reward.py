"""
Long-term reward engineering for V2B DDPG (arXiv:2502.18526).

Paper core (Section 4.1):

    R(S, A) = λ_S · r_1 + λ_E · r_2 + λ_D · r_3

    r_1 = Σ_i max(0, min(KWH^R_i, P_i · δ))           — charging satisfaction
    r_2 = Σ_i -P_i · δ · θ_E(T_j)                     — electricity cost
    r_3 = -max(0, B + Σ_i P_i - P̂^max) · θ_D         — peak / demand charge

This module adds renewable and battery-health terms for deployment-ready training
while keeping the paper structure as the default backbone.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

# Slot duration δ (hours) — align with action_mask / state_builder
DEFAULT_DELTA_HOURS = 1.0

# Paper Table 5 default penalty coefficients (λ_S, λ_E, λ_D)
DEFAULT_LAMBDA_SATISFACTION = 1.0
DEFAULT_LAMBDA_ENERGY = 1.0
DEFAULT_LAMBDA_DEMAND = 3.0

# Typical tariff scaling (USD per kWh, USD per kW) — tune to your utility rate
DEFAULT_THETA_ENERGY = 0.25
DEFAULT_THETA_DEMAND = 15.0

# Extension weights (0 disables a term)
DEFAULT_LAMBDA_RENEWABLE = 0.5
DEFAULT_LAMBDA_BATTERY = 0.3

# Numerical stability
DEFAULT_EPSILON = 1e-8


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RewardWeights:
    """
    Configurable coefficients for the multi-objective reward.

    Paper defaults: λ_S=1, λ_E=1, λ_D=3 (demand charge weighted higher).
    """

    lambda_satisfaction: float = DEFAULT_LAMBDA_SATISFACTION
    lambda_energy: float = DEFAULT_LAMBDA_ENERGY
    lambda_demand: float = DEFAULT_LAMBDA_DEMAND
    lambda_renewable: float = DEFAULT_LAMBDA_RENEWABLE
    lambda_battery: float = DEFAULT_LAMBDA_BATTERY

    # Tariff multipliers θ_E, θ_D
    theta_energy: float = DEFAULT_THETA_ENERGY
    theta_demand: float = DEFAULT_THETA_DEMAND

    # Sub-term scaling inside extensions
    soc_target_bonus_scale: float = 1.0
    unmet_demand_penalty_scale: float = 2.0
    renewable_utilization_scale: float = 0.5
    fast_charge_penalty_scale: float = 0.3
    deep_discharge_penalty_scale: float = 0.5
    degradation_penalty_scale: float = 0.4


@dataclass
class V2BRewardContext:
    """
    Physical inputs for Reward(S(T_j), A(T_j)) at one decision step.

    Arrays are per charger; scalars are site-level. Use masked actions A'
    (kW) after action_mask for consistent feasibility.
    """

    action_kw: np.ndarray  # P(C_i, T_j) [kW], length N
    kwh_required: np.ndarray  # KWH^R [kWh] remaining to SOC^R
    connected: np.ndarray  # bool, EV plugged in
    building_power_kw: float  # B(T_j)
    estimated_peak_power_kw: float  # P̂^max(T_j)
    electricity_price: float | np.ndarray  # θ_E(T_j) [USD/kWh]
    delta_hours: float = DEFAULT_DELTA_HOURS

    # Optional — extensions & terminal satisfaction
    soc_current: np.ndarray | None = None
    soc_target: np.ndarray | None = None
    battery_capacity_kwh: np.ndarray | None = None
    c_max: np.ndarray | None = None
    tau_remaining_slots: np.ndarray | None = None
    solar_availability: float = 0.0  # [0, 1]
    renewable_utilization: float = 0.0  # [0, 1]
    battery_degradation: float = 0.0  # [0, 1]
    is_terminal_step: bool = False  # end of session / episode slice

    @property
    def num_chargers(self) -> int:
        return int(np.asarray(self.action_kw).reshape(-1).shape[0])

    @classmethod
    def from_gym(
        cls,
        action_kw: np.ndarray,
        info: dict[str, Any],
        *,
        delta_hours: float = DEFAULT_DELTA_HOURS,
        is_terminal: bool = False,
    ) -> V2BRewardContext:
        """Build context from Gymnasium ``info`` (same keys as action_mask)."""
        n = int(info.get("num_chargers", np.asarray(action_kw).size))

        def _vec(key: str, default: float) -> np.ndarray:
            if key in info:
                return np.asarray(info[key], dtype=np.float64).reshape(-1)
            return np.full(n, default, dtype=np.float64)

        price = info.get("electricity_price_usd_per_kwh", info.get("tou_price_usd", 0.25))
        if isinstance(price, (list, np.ndarray)):
            price_arr = np.asarray(price, dtype=np.float64).reshape(-1)
        else:
            price_arr = float(price)

        connected = info.get("connected")
        if connected is None:
            tau = _vec("tau_remaining_slots", 0.0)
            connected = tau > 0
        else:
            connected = np.asarray(connected, dtype=bool).reshape(-1)

        return cls(
            action_kw=np.asarray(action_kw, dtype=np.float64).reshape(-1),
            kwh_required=_vec("kwh_required", 0.0),
            connected=connected,
            building_power_kw=float(info.get("building_power_kw", 0.0)),
            estimated_peak_power_kw=float(info.get("estimated_peak_power_kw", 1.0)),
            electricity_price=price_arr,
            delta_hours=delta_hours,
            soc_current=_vec("soc_current", 0.5) if "soc_current" in info else None,
            soc_target=_vec("soc_target", 0.9) if "soc_target" in info else None,
            battery_capacity_kwh=_vec("battery_capacity_kwh", 60.0)
            if "battery_capacity_kwh" in info
            else None,
            c_max=_vec("c_max", 7.2) if "c_max" in info else None,
            tau_remaining_slots=_vec("tau_remaining_slots", 0.0)
            if "tau_remaining_slots" in info
            else None,
            solar_availability=float(info.get("solar_availability", 0.0)),
            renewable_utilization=float(info.get("renewable_utilization", 0.0)),
            battery_degradation=float(info.get("battery_degradation", 0.0)),
            is_terminal_step=is_terminal,
        )


# ---------------------------------------------------------------------------
# Modular reward terms
# ---------------------------------------------------------------------------


def _as_vectors(ctx: V2BRewardContext) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    n = ctx.num_chargers
    p = np.asarray(ctx.action_kw, dtype=np.float64).reshape(-1)
    kwh_r = np.asarray(ctx.kwh_required, dtype=np.float64).reshape(-1)
    conn = np.asarray(ctx.connected, dtype=bool).reshape(-1)
    if p.size != n or kwh_r.size != n or conn.size != n:
        raise ValueError("action_kw, kwh_required, connected must have same length")
    return p, kwh_r, conn


def _price_per_charger(ctx: V2BRewardContext, n: int) -> np.ndarray:
    """θ_E(T_j) per charger (uniform or vector)."""
    price = ctx.electricity_price
    if isinstance(price, np.ndarray):
        arr = np.asarray(price, dtype=np.float64).reshape(-1)
        if arr.size == 1:
            return np.full(n, arr[0], dtype=np.float64)
        return arr
    return np.full(n, float(price), dtype=np.float64)


def charging_reward(
    ctx: V2BRewardContext,
    weights: RewardWeights,
) -> tuple[float, dict[str, float]]:
    """
    Paper r_1 — charging satisfaction (Equation 7 alignment).

        r_1 = Σ_i max(0, min(KWH^R_i, P_i · δ))

    Effective energy delivered toward the requirement this slot, ignoring
    overcharge beyond KWH^R. Extensions:
    - SOC target bonus at terminal step when SOC ≥ SOC^R
    - Penalty for unmet energy demand near departure
    """
    p, kwh_r, conn = _as_vectors(ctx)
    delta = ctx.delta_hours

    # Core paper term: only count charging that fills remaining need
    energy_toward_need = np.maximum(p, 0.0) * delta
    per_charger = np.maximum(0.0, np.minimum(np.maximum(kwh_r, 0.0), energy_toward_need))
    per_charger = np.where(conn, per_charger, 0.0)
    r1 = float(np.sum(per_charger))

    # Normalize for DDPG stability (typical slot ~0–50 kWh scale)
    r1_norm = r1 / max(float(np.sum(ctx.c_max) if ctx.c_max is not None else 50.0) * delta, 1e-6)

    soc_bonus = 0.0
    unmet_penalty = 0.0

    if ctx.soc_current is not None and ctx.soc_target is not None:
        soc = np.asarray(ctx.soc_current, dtype=np.float64).reshape(-1)
        tgt = np.asarray(ctx.soc_target, dtype=np.float64).reshape(-1)

        if ctx.is_terminal_step:
            # Bonus for meeting target SoC at departure
            met = conn & (soc >= tgt - 0.02)
            soc_bonus = float(weights.soc_target_bonus_scale * np.sum(met) / max(n := len(soc), 1))

        # Penalize remaining unmet kWh (especially when time is short)
        unmet_kwh = np.maximum(kwh_r, 0.0)
        urgency = 1.0
        if ctx.tau_remaining_slots is not None:
            tau = np.asarray(ctx.tau_remaining_slots, dtype=np.float64).reshape(-1)
            urgency = np.where(tau <= 1.0, 2.0, np.where(tau <= 2.0, 1.5, 1.0))
        unmet_penalty = float(
            weights.unmet_demand_penalty_scale
            * np.sum(unmet_kwh * urgency * conn)
            / max(np.sum(ctx.battery_capacity_kwh) if ctx.battery_capacity_kwh is not None else 60.0 * n, 1e-6)
        )

    total = r1_norm + soc_bonus - unmet_penalty
    detail = {
        "r1_paper_kwh": r1,
        "r1_normalized": r1_norm,
        "soc_target_bonus": soc_bonus,
        "unmet_demand_penalty": -unmet_penalty,
    }
    return total, detail


def electricity_cost_penalty(
    ctx: V2BRewardContext,
    weights: RewardWeights,
) -> tuple[float, dict[str, float]]:
    """
    Paper r_2 — electricity cost (TOU energy charge).

        r_2 = Σ_i -P_i · δ · θ_E(T_j)

    Charging (P > 0) incurs cost; V2B discharge (P < 0) offsets cost.
    """
    p, _, conn = _as_vectors(ctx)
    delta = ctx.delta_hours
    n = ctx.num_chargers
    theta_e = _price_per_charger(ctx, n) * weights.theta_energy

    # Only bill connected chargers; idle slots should not affect cost
    energy_kwh = p * delta * conn.astype(np.float64)
    r2 = float(np.sum(-energy_kwh * theta_e))

    # Scale to roughly O(1) for critic learning
    scale = max(float(np.max(theta_e)) * delta * max(float(np.max(np.abs(p))), 1.0) * n, 1e-6)
    r2_norm = r2 / scale

    detail = {
        "r2_paper_cost_usd": r2,
        "r2_normalized": r2_norm,
        "energy_kwh_net": float(np.sum(energy_kwh)),
    }
    return r2_norm, detail


def peak_demand_penalty(
    ctx: V2BRewardContext,
    weights: RewardWeights,
) -> tuple[float, dict[str, float]]:
    """
    Paper r_3 — demand charge / peak shaving.

        r_3 = -max(0, B(T_j) + Σ_i P_i - P̂^max(T_j)) · θ_D

    Penalizes total site power above the running monthly peak estimate.
    """
    p, _, _ = _as_vectors(ctx)
    total_ev_power = float(np.sum(p))
    net_power = ctx.building_power_kw + total_ev_power
    excess = max(0.0, net_power - ctx.estimated_peak_power_kw)

    r3 = -excess * weights.theta_demand

    # Normalized penalty in [0, ~1] when excess is a fraction of peak
    peak_ref = max(ctx.estimated_peak_power_kw, 1.0)
    r3_norm = r3 / (peak_ref * weights.theta_demand + DEFAULT_EPSILON)

    # Small reward for staying below peak (peak shaving encouragement)
    headroom = max(0.0, ctx.estimated_peak_power_kw - net_power)
    shave_bonus = 0.1 * (headroom / peak_ref)

    total = r3_norm + shave_bonus
    detail = {
        "r3_paper_penalty": r3,
        "r3_normalized": r3_norm,
        "net_power_kw": net_power,
        "excess_above_peak_kw": excess,
        "peak_shave_bonus": shave_bonus,
    }
    return total, detail


def renewable_bonus(
    ctx: V2BRewardContext,
    weights: RewardWeights,
) -> tuple[float, dict[str, float]]:
    """
    Reward alignment with onsite solar / renewables (extension).

    - Bonus for charging when solar availability is high
    - Bonus for renewable utilization ratio (PV energy serving EV load)
    """
    p, _, conn = _as_vectors(ctx)
    delta = ctx.delta_hours
    solar = float(np.clip(ctx.solar_availability, 0.0, 1.0))
    util = float(np.clip(ctx.renewable_utilization, 0.0, 1.0))

    charge_kw = np.maximum(p, 0.0) * conn.astype(np.float64)
    charge_kwh = float(np.sum(charge_kw) * delta)

    # Prefer charging when sun is available
    solar_aligned = (charge_kwh / max(charge_kwh + 1e-6, 1e-6)) * solar * charge_kwh
    solar_term = solar_aligned / max(float(np.sum(ctx.c_max) if ctx.c_max is not None else 50.0) * delta, 1e-6)

    util_term = weights.renewable_utilization_scale * util

    total = solar_term + util_term
    detail = {
        "solar_aligned_charge": solar_term,
        "utilization_bonus": util_term,
        "solar_availability": solar,
        "renewable_utilization": util,
    }
    return total, detail


def battery_health_penalty(
    ctx: V2BRewardContext,
    weights: RewardWeights,
) -> tuple[float, dict[str, float]]:
    """
    Battery degradation penalties (extension).

    - Fast charging: power near C^max
    - Deep discharge: SOC near SOC^min while discharging
    - Cumulative degradation score from state / cycle history
    """
    p, _, conn = _as_vectors(ctx)
    n = ctx.num_chargers
    delta = ctx.delta_hours

    fast_pen = 0.0
    if ctx.c_max is not None:
        c_max = np.asarray(ctx.c_max, dtype=np.float64).reshape(-1)
        ratio = np.abs(p) / np.maximum(c_max, 1e-6)
        # Penalize using >80% of charger rating
        fast_pen = float(
            weights.fast_charge_penalty_scale
            * np.sum(np.maximum(0.0, ratio - 0.8) * conn.astype(np.float64))
            / n
        )

    deep_pen = 0.0
    if ctx.soc_current is not None and p.size == n:
        soc = np.asarray(ctx.soc_current, dtype=np.float64).reshape(-1)
        soc_min = 0.10
        discharging = p < 0
        depth = np.maximum(0.0, soc_min + 0.05 - soc)  # within 5% of floor
        deep_pen = float(
            weights.deep_discharge_penalty_scale
            * np.sum(depth * discharging.astype(np.float64) * conn.astype(np.float64))
        )

    deg = float(np.clip(ctx.battery_degradation, 0.0, 1.0))
    deg_pen = weights.degradation_penalty_scale * deg

    total = -(fast_pen + deep_pen + deg_pen)
    detail = {
        "fast_charge_penalty": -fast_pen,
        "deep_discharge_penalty": -deep_pen,
        "degradation_penalty": -deg_pen,
    }
    return total, detail


# ---------------------------------------------------------------------------
# RewardFunction orchestrator
# ---------------------------------------------------------------------------


@dataclass
class RewardBreakdown:
    """Structured result from ``compute_reward``."""

    total: float
    charging_satisfaction: float
    electricity_cost: float
    peak_demand: float
    renewable: float
    battery_health: float
    weighted: dict[str, float] = field(default_factory=dict)
    raw: dict[str, float] = field(default_factory=dict)
    details: dict[str, dict[str, float]] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "total": self.total,
            "charging_satisfaction": self.charging_satisfaction,
            "electricity_cost": self.electricity_cost,
            "peak_demand": self.peak_demand,
            "renewable": self.renewable,
            "battery_health": self.battery_health,
            "weighted": self.weighted,
            "raw": self.raw,
            "details": self.details,
        }


class RewardFunction:
    """
    Long-term V2B reward for DDPG training.

    Combines paper (r_1, r_2, r_3) with renewable and battery terms::

        R = λ_S·r̃_1 + λ_E·r̃_2 + λ_D·r̃_3 + λ_R·r̃_4 + λ_B·r̃_5

    Use **masked** continuous actions (kW) from ``ActionMask`` for consistent rewards.
    """

    TERM_NAMES = (
        "charging_satisfaction",
        "electricity_cost",
        "peak_demand",
        "renewable",
        "battery_health",
    )

    def __init__(self, weights: RewardWeights | None = None) -> None:
        self.weights = weights or RewardWeights()

    def compute_reward(
        self,
        ctx: V2BRewardContext,
    ) -> tuple[float, dict[str, Any]]:
        """
        Compute scalar reward and full breakdown dict for logging / Gym ``info``.

        Returns
        -------
        total : float
            Scalar reward for DDPG (maximize).
        breakdown : dict
            Nested components for TensorBoard / debugging.
        """
        result = self._compute_breakdown(ctx)
        return result.total, result.to_dict()

    def _compute_breakdown(self, ctx: V2BRewardContext) -> RewardBreakdown:
        w = self.weights

        r1, d1 = charging_reward(ctx, w)
        r2, d2 = electricity_cost_penalty(ctx, w)
        r3, d3 = peak_demand_penalty(ctx, w)
        r4, d4 = renewable_bonus(ctx, w)
        r5, d5 = battery_health_penalty(ctx, w)

        weighted = {
            "charging_satisfaction": w.lambda_satisfaction * r1,
            "electricity_cost": w.lambda_energy * r2,
            "peak_demand": w.lambda_demand * r3,
            "renewable": w.lambda_renewable * r4,
            "battery_health": w.lambda_battery * r5,
        }

        # Paper combination + extensions
        total = float(sum(weighted.values()))

        return RewardBreakdown(
            total=total,
            charging_satisfaction=r1,
            electricity_cost=r2,
            peak_demand=r3,
            renewable=r4,
            battery_health=r5,
            weighted=weighted,
            raw={
                "r1_charging": r1,
                "r2_electricity": r2,
                "r3_peak": r3,
                "r4_renewable": r4,
                "r5_battery": r5,
            },
            details={
                "charging_satisfaction": d1,
                "electricity_cost": d2,
                "peak_demand": d3,
                "renewable": d4,
                "battery_health": d5,
            },
        )

    def compute_reward_for_gym(
        self,
        action_kw: np.ndarray,
        info: dict[str, Any],
        *,
        is_terminal: bool = False,
    ) -> tuple[float, dict[str, Any]]:
        """Gymnasium helper: build context from ``info`` and return (reward, breakdown)."""
        ctx = V2BRewardContext.from_gym(
            action_kw,
            info,
            delta_hours=float(info.get("delta_hours", DEFAULT_DELTA_HOURS)),
            is_terminal=is_terminal,
        )
        return self.compute_reward(ctx)

    def compute_paper_reward_only(self, ctx: V2BRewardContext) -> float:
        """
        Exact paper combination without extensions (λ_R = λ_B = 0).

        R = λ_S·r_1 + λ_E·r_2 + λ_D·r_3
        """
        w = RewardWeights(
            lambda_satisfaction=self.weights.lambda_satisfaction,
            lambda_energy=self.weights.lambda_energy,
            lambda_demand=self.weights.lambda_demand,
            lambda_renewable=0.0,
            lambda_battery=0.0,
            theta_energy=self.weights.theta_energy,
            theta_demand=self.weights.theta_demand,
        )
        r1, _ = charging_reward(ctx, w)
        r2, _ = electricity_cost_penalty(ctx, w)
        r3, _ = peak_demand_penalty(ctx, w)
        # Use unnormalized paper-scale components for fidelity
        p, kwh_r, conn = _as_vectors(ctx)
        delta = ctx.delta_hours
        paper_r1 = float(
            np.sum(
                np.maximum(
                    0.0,
                    np.minimum(
                        np.maximum(kwh_r, 0.0),
                        np.maximum(p, 0.0) * delta,
                    ),
                )
                * conn.astype(np.float64)
            )
        )
        theta_e = _price_per_charger(ctx, ctx.num_chargers)
        paper_r2 = float(np.sum(-p * delta * theta_e * conn.astype(np.float64)))
        excess = max(
            0.0,
            ctx.building_power_kw + float(np.sum(p)) - ctx.estimated_peak_power_kw,
        )
        paper_r3 = -excess * w.theta_demand

        return (
            w.lambda_satisfaction * paper_r1
            + w.lambda_energy * paper_r2
            + w.lambda_demand * paper_r3
        )


# ---------------------------------------------------------------------------
# Demo
# ---------------------------------------------------------------------------


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    reward_fn = RewardFunction()
    ctx = V2BRewardContext(
        action_kw=np.array([5.0]),
        kwh_required=np.array([10.0]),
        connected=np.array([True]),
        building_power_kw=80.0,
        estimated_peak_power_kw=150.0,
        electricity_price=0.22,
        soc_current=np.array([0.5]),
        soc_target=np.array([0.9]),
        battery_capacity_kwh=np.array([60.0]),
        c_max=np.array([7.2]),
        solar_availability=0.7,
        renewable_utilization=0.4,
    )

    total, breakdown = reward_fn.compute_reward(ctx)
    paper = reward_fn.compute_paper_reward_only(ctx)

    print("total reward:", round(total, 4))
    print("paper-only reward:", round(paper, 4))
    print("weighted:", {k: round(v, 4) for k, v in breakdown["weighted"].items()})


if __name__ == "__main__":
    main()
