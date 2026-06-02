"""
Explainable AI (XAI) layer for V2B Neural Grid — RL decision interpretability.

Transforms DDPG actions, telemetry state, and reward proxies into structured,
human-readable explanations for the command-center dashboard.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np

from backend.rl.rl_config import ACTION_NAMES, STATE_FEATURE_NAMES
from backend.rl_interfaces import compute_reward_components

# ---------------------------------------------------------------------------
# Thresholds (aligned with grid_intelligence / training reward)
# ---------------------------------------------------------------------------

THERMAL_WARN_C = 38.0
THERMAL_CRIT_C = 42.0
STRESS_HIGH = 0.55
STRESS_CRIT = 0.72
RENEWABLE_TARGET = 0.35
DEGRADATION_WARN = 6.0
ANOMALY_WARN = 1.5

GOAL_LABELS: tuple[str, ...] = (
    "renewable_maximization",
    "battery_protection",
    "stress_reduction",
    "peak_reduction",
    "load_balancing",
)

ACTION_HUMAN_LABELS: dict[str, str] = {
    "charging_rate_adjustment": "Aggregate charging rate",
    "renewable_allocation": "Renewable energy routing",
    "load_shift_factor": "Load shifting across fleet",
    "battery_protection_strength": "Battery protection intensity",
    "peak_shaving_factor": "Peak shaving aggressiveness",
}


def _num(row: dict[str, Any] | None, key: str, default: float = 0.0) -> float:
    if not row:
        return default
    try:
        v = float(row.get(key, default))
        return v if np.isfinite(v) else default
    except (TypeError, ValueError):
        return default


def _pct(v: float, as_ratio: bool = True) -> str:
    if as_ratio and abs(v) <= 1.0:
        return f"{abs(v) * 100:.0f}%"
    return f"{abs(v):.1f}"


def _impact_level(score: float) -> str:
    if score >= 0.72:
        return "high"
    if score >= 0.42:
        return "medium"
    if score >= 0.18:
        return "low"
    return "minimal"


# ---------------------------------------------------------------------------
# RL action interpretation
# ---------------------------------------------------------------------------


def interpret_rl_action(name: str, value: float) -> dict[str, Any]:
    """Translate normalized DDPG action in [-1, 1] to operator language."""
    label = ACTION_HUMAN_LABELS.get(name, name.replace("_", " ").title())
    magnitude = abs(float(value))
    direction = "increase" if value > 0.05 else "decrease" if value < -0.05 else "hold"

    if name == "charging_rate_adjustment":
        if direction == "decrease":
            sentence = f"Reduce aggregate charging power by {_pct(magnitude)}."
        elif direction == "increase":
            sentence = f"Increase aggregate charging power by {_pct(magnitude)}."
        else:
            sentence = "Maintain current aggregate charging setpoints."
    elif name == "renewable_allocation":
        if direction == "increase":
            sentence = f"Route an additional {_pct(magnitude)} of demand to on-site renewables."
        elif direction == "decrease":
            sentence = f"Reduce renewable routing by {_pct(magnitude)}; blend with grid import."
        else:
            sentence = "Hold renewable dispatch at current blend ratio."
    elif name == "load_shift_factor":
        if direction == "increase":
            sentence = f"Shift up to {_pct(magnitude)} of discretionary load to lower-stress windows."
        elif direction == "decrease":
            sentence = "Defer load shifting; keep present session schedule."
        else:
            sentence = "No material load shift recommended this cycle."
    elif name == "battery_protection_strength":
        if magnitude > 0.35:
            sentence = (
                f"Battery protection intensified ({_pct(magnitude)}) — "
                "limit deep cycles, fast-charge ramp, and upper SOC band."
            )
        elif magnitude > 0.1:
            sentence = f"Apply moderate battery protection ({_pct(magnitude)} strength)."
        else:
            sentence = "Standard SOH preservation; no extra protection mask."
    elif name == "peak_shaving_factor":
        if magnitude > 0.35:
            sentence = (
                f"Peak shaving activated ({_pct(magnitude)}) to prevent overload "
                "during projected demand crest."
            )
        elif magnitude > 0.1:
            sentence = f"Moderate peak shaving ({_pct(magnitude)}) on non-critical charging."
        else:
            sentence = "Peak shaving on standby — monitor demand only."
    else:
        sentence = f"{label}: {direction} by {_pct(magnitude)}."

    return {
        "action": name,
        "value": round(float(value), 4),
        "direction": direction,
        "magnitude_pct": round(magnitude * 100, 1),
        "interpretation": sentence,
    }


def interpret_all_actions(actions: dict[str, float] | None) -> list[dict[str, Any]]:
    if not actions:
        return [interpret_rl_action(n, 0.0) for n in ACTION_NAMES]
    return [interpret_rl_action(n, float(actions.get(n, 0.0))) for n in ACTION_NAMES]


# ---------------------------------------------------------------------------
# Telemetry contribution analysis
# ---------------------------------------------------------------------------


def _feature_influence(row: dict[str, Any], actions: dict[str, float] | None) -> float:
    """Heuristic influence score in [0, 1] for a single telemetry feature."""
    actions = actions or {}
    stress = _num(row, "grid_stress_index")
    renewable = _num(row, "renewable_ratio")
    thermal = _num(row, "thermal_index")
    degradation = _num(row, "degradation_score")
    anomaly = _num(row, "anomaly_score")
    soc = _num(row, "soc_percent")
    util = _num(row, "charger_utilization")
    load = _num(row, "grid_load_kw")
    peak_kw = _num(row, "peak_demand_kw", load)

    influences: dict[str, float] = {
        "grid_stress_index": min(1.0, stress * 1.15 + abs(actions.get("peak_shaving_factor", 0)) * 0.25),
        "renewable_ratio": min(
            1.0,
            abs(renewable - RENEWABLE_TARGET) * 1.2 + abs(actions.get("renewable_allocation", 0)) * 0.35,
        ),
        "thermal_index": min(
            1.0,
            max(0.0, (thermal - 32.0) / 14.0) + abs(actions.get("battery_protection_strength", 0)) * 0.2,
        ),
        "degradation_score": min(1.0, degradation / 12.0 + abs(actions.get("battery_protection_strength", 0)) * 0.3),
        "anomaly_score": min(1.0, anomaly / 4.0),
        "soc_percent": min(1.0, abs(soc - 85.0) / 40.0 + (0.25 if soc >= 90 else 0)),
        "charger_utilization": min(1.0, util * 0.9 + abs(actions.get("load_shift_factor", 0)) * 0.2),
        "grid_load_kw": min(1.0, load / max(peak_kw, 1.0) * 0.85 + abs(actions.get("charging_rate_adjustment", 0)) * 0.25),
        "charging_power_kw": min(
            1.0,
            _num(row, "charging_power_kw") / max(load, 1.0) * 0.7
            + abs(actions.get("charging_rate_adjustment", 0)) * 0.35,
        ),
    }
    return influences


def compute_contributions(
    row: dict[str, Any],
    actions: dict[str, float] | None = None,
    top_k: int = 6,
) -> list[dict[str, Any]]:
    """Rank telemetry factors by estimated influence on the RL decision."""
    scores = _feature_influence(row, actions)
    ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)[:top_k]

    out: list[dict[str, Any]] = []
    for factor, score in ranked:
        raw = _num(row, factor)
        if factor in ("renewable_ratio", "grid_stress_index", "charger_utilization"):
            display_value = round(raw, 4)
        elif factor == "soc_percent":
            display_value = round(raw, 1)
        else:
            display_value = round(raw, 2)

        out.append(
            {
                "factor": factor,
                "impact": _impact_level(score),
                "influence_score": round(float(score), 4),
                "value": display_value,
                "unit": "%" if factor in ("soc_percent",) else ("ratio" if factor.endswith("ratio") or factor.endswith("index") and factor != "thermal_index" else "raw"),
            }
        )
    return out


# ---------------------------------------------------------------------------
# Goal prioritization
# ---------------------------------------------------------------------------


def rank_optimization_priorities(
    row: dict[str, Any],
    actions: dict[str, float] | None = None,
    reward_components: dict[str, float] | None = None,
) -> list[dict[str, Any]]:
    """Rank optimization goals for the current decision cycle."""
    actions = actions or {}
    reward_components = reward_components or compute_reward_components(row)

    stress = _num(row, "grid_stress_index")
    renewable = _num(row, "renewable_ratio")
    thermal = _num(row, "thermal_index")
    degradation = _num(row, "degradation_score")
    peak_penalty = _num(row, "peak_penalty")
    anomaly = _num(row, "anomaly_score")
    util = _num(row, "charger_utilization")

    scores = {
        "renewable_maximization": (
            max(0.0, RENEWABLE_TARGET - renewable) * 1.4
            + max(0.0, actions.get("renewable_allocation", 0)) * 0.5
            + max(0.0, reward_components.get("r_renewable", 0)) * 0.3
        ),
        "battery_protection": (
            max(0.0, (thermal - THERMAL_WARN_C) / 8.0)
            + degradation / 12.0
            + max(0.0, actions.get("battery_protection_strength", 0)) * 0.55
            + (0.35 if _num(row, "soc_percent") >= 88 else 0)
        ),
        "stress_reduction": (
            stress * 1.25
            + max(0.0, -reward_components.get("r_cost", 0)) * 0.4
            + abs(actions.get("charging_rate_adjustment", 0)) * 0.15 * (1 if stress > STRESS_HIGH else 0)
        ),
        "peak_reduction": (
            peak_penalty * 1.5
            + stress * 0.4
            + max(0.0, actions.get("peak_shaving_factor", 0)) * 0.6
            + max(0.0, -reward_components.get("r_peak", 0)) * 0.25
        ),
        "load_balancing": (
            util * 0.7
            + abs(actions.get("load_shift_factor", 0)) * 0.55
            + min(anomaly / 5.0, 0.4)
        ),
    }

    ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    total = sum(s for _, s in ranked) or 1.0

    labels = {
        "renewable_maximization": "Renewable maximization",
        "battery_protection": "Battery protection",
        "stress_reduction": "Grid stress reduction",
        "peak_reduction": "Peak demand reduction",
        "load_balancing": "Fleet load balancing",
    }

    return [
        {
            "goal": goal,
            "label": labels.get(goal, goal),
            "priority": rank + 1,
            "score": round(float(score), 4),
            "weight_pct": round(100.0 * score / total, 1),
            "active": score >= 0.25,
        }
        for rank, (goal, score) in enumerate(ranked)
    ]


# ---------------------------------------------------------------------------
# Safety explanations
# ---------------------------------------------------------------------------


def build_safety_explanations(row: dict[str, Any], actions: dict[str, float] | None = None) -> dict[str, Any]:
    actions = actions or {}
    thermal = _num(row, "thermal_index")
    stress = _num(row, "grid_stress_index")
    degradation = _num(row, "degradation_score")
    anomaly = _num(row, "anomaly_score")
    load = _num(row, "grid_load_kw")
    peak = _num(row, "peak_demand_kw", load)
    util = _num(row, "charger_utilization")

    items: list[dict[str, str]] = []

    if thermal >= THERMAL_CRIT_C:
        items.append(
            {
                "category": "thermal_mitigation",
                "severity": "critical",
                "explanation": (
                    f"Emergency thermal mitigation: fleet index {thermal:.1f}°C exceeds "
                    f"{THERMAL_CRIT_C:.0f}°C — throttle DC fast and cap charge ramp."
                ),
            }
        )
    elif thermal >= THERMAL_WARN_C:
        items.append(
            {
                "category": "thermal_mitigation",
                "severity": "high",
                "explanation": (
                    f"Thermal guard active at {thermal:.1f}°C — reduce fast-charge duty cycle "
                    "and monitor cell temperatures."
                ),
            }
        )

    if stress > STRESS_CRIT or load >= peak * 0.97:
        items.append(
            {
                "category": "overload_prevention",
                "severity": "critical",
                "explanation": (
                    f"Overload prevention: grid stress {(stress * 100):.0f}% with "
                    f"{load:.0f} kW load near {peak:.0f} kW peak capacity."
                ),
            }
        )
    elif stress > STRESS_HIGH:
        items.append(
            {
                "category": "overload_prevention",
                "severity": "high",
                "explanation": (
                    f"Elevated grid stress {(stress * 100):.0f}% — capping discretionary charging "
                    f"by ~{int(load * 0.06)} kW."
                ),
            }
        )

    if degradation > DEGRADATION_WARN:
        items.append(
            {
                "category": "degradation_protection",
                "severity": "medium" if degradation < 9 else "high",
                "explanation": (
                    f"Degradation protection: SOH proxy {degradation:.1f} — "
                    "limit V2B depth and deep discharge cycles."
                ),
            }
        )

    if anomaly > ANOMALY_WARN:
        items.append(
            {
                "category": "anomaly_mitigation",
                "severity": "critical" if anomaly > 3 else "high",
                "explanation": (
                    f"Anomaly mitigation: score {anomaly:.2f} vs baseline — "
                    "validate concurrent sessions and load spikes."
                ),
            }
        )

    if util > 0.88:
        items.append(
            {
                "category": "charger_saturation",
                "severity": "high",
                "explanation": (
                    f"Charger saturation at {(util * 100):.0f}% utilization — "
                    "stagger sessions to avoid concurrent overload."
                ),
            }
        )

    batt_strength = actions.get("battery_protection_strength", 0)
    if batt_strength > 0.4:
        items.append(
            {
                "category": "policy_battery_guard",
                "severity": "medium",
                "explanation": (
                    f"DDPG elevated battery protection ({batt_strength:.2f}) in response to "
                    "thermal or degradation signals."
                ),
            }
        )

    if not items:
        items.append(
            {
                "category": "nominal",
                "severity": "low",
                "explanation": "All safety envelopes within nominal bounds; policy in tracking mode.",
            }
        )

    return {"items": items, "count": len(items)}


# ---------------------------------------------------------------------------
# Narrative builders
# ---------------------------------------------------------------------------


def _build_summary(
    row: dict[str, Any],
    inference: dict[str, Any],
    actions: dict[str, float] | None,
    priorities: list[dict[str, Any]],
) -> str:
    stress = _num(row, "grid_stress_index")
    renewable = _num(row, "renewable_ratio")
    top_goal = priorities[0]["label"] if priorities else "Grid optimization"
    policy = inference.get("optimization_action", "steady_state")
    charging_adj = (actions or {}).get("charging_rate_adjustment", 0)

    if charging_adj < -0.3 and stress > STRESS_HIGH:
        return (
            f"Charging load reduced because grid stress exceeded {(stress * 100):.0f}% "
            f"while renewable availability is {(renewable * 100):.0f}%."
        )
    if renewable >= RENEWABLE_TARGET:
        return (
            f"Renewable-first dispatch active ({(renewable * 100):.0f}% mix) — "
            f"primary objective: {top_goal.lower()}."
        )
    return (
        f"DDPG policy executing {policy.replace('_', ' ')} with "
        f"priority on {top_goal.lower()} (stress {(stress * 100):.0f}%)."
    )


def _build_reasoning(
    row: dict[str, Any],
    contributions: list[dict[str, Any]],
    action_interpretations: list[dict[str, Any]],
) -> str:
    drivers = ", ".join(
        f"{c['factor']} ({c['impact']})" for c in contributions[:3]
    ) or "baseline telemetry"
    primary_action = max(
        action_interpretations,
        key=lambda a: abs(a.get("value", 0)),
        default={"interpretation": "Hold current setpoints."},
    )
    return (
        f"Decision driven by {drivers}. "
        f"{primary_action['interpretation']}"
    )


def _build_risk_analysis(row: dict[str, Any], inference: dict[str, Any]) -> str:
    risk = inference.get("risk_level", "medium")
    stress = _num(row, "grid_stress_index")
    anomaly = _num(row, "anomaly_score")
    peak_penalty = _num(row, "peak_penalty")

    mitigated: list[str] = []
    if stress > STRESS_HIGH:
        mitigated.append(f"grid stress ({(stress * 100):.0f}%)")
    if peak_penalty > 0.3:
        mitigated.append(f"peak penalty ({(peak_penalty * 100):.0f}%)")
    if anomaly > ANOMALY_WARN:
        mitigated.append(f"anomaly spike ({anomaly:.2f})")

    if mitigated:
        return (
            f"Overall risk: {risk}. Active mitigations targeting "
            f"{', '.join(mitigated)} via coordinated charging and V2B masks."
        )
    return f"Overall risk: {risk}. No acute threats; maintaining predictive tracking."


def _build_renewable_strategy(row: dict[str, Any], inference: dict[str, Any], actions: dict[str, float] | None) -> str:
    renewable = _num(row, "renewable_ratio")
    solar = _num(row, "solar_generation_kw")
    alloc = (actions or {}).get("renewable_allocation", 0)
    base = inference.get("renewable_strategy", "")

    if renewable >= RENEWABLE_TARGET:
        return (
            f"Maximize on-site PV offset — {(renewable * 100):.0f}% renewable mix "
            f"with {solar:.0f} kW solar generation. {base}"
        )
    if alloc > 0.2:
        return (
            f"Policy increasing renewable routing ({alloc:.2f}) despite "
            f"{(renewable * 100):.0f}% current mix — preparing for next solar window."
        )
    return (
        f"Renewable below target ({(renewable * 100):.0f}% vs {RENEWABLE_TARGET * 100:.0f}%) — "
        f"defer discretionary load. {base}"
    )


def _build_battery_strategy(row: dict[str, Any], inference: dict[str, Any], actions: dict[str, float] | None) -> str:
    thermal = _num(row, "thermal_index")
    degradation = _num(row, "degradation_score")
    soc = _num(row, "soc_percent")
    strength = (actions or {}).get("battery_protection_strength", 0)

    if thermal >= THERMAL_WARN_C or degradation > DEGRADATION_WARN:
        return (
            f"Battery protection intensified due to "
            f"{'elevated thermal index' if thermal >= THERMAL_WARN_C else 'degradation trend'} "
            f"({thermal:.1f}°C, degradation {degradation:.1f}). "
            f"{inference.get('battery_protection_action', '')}"
        )
    if soc >= 88:
        return f"SOC guard at {soc:.0f}% — upper band clamp and trickle charge. {inference.get('battery_protection_action', '')}"
    if strength > 0.35:
        return f"Actor requested protection strength {strength:.2f} — limiting deep cycles."
    return inference.get("battery_protection_action", "Standard SOH preservation active.")


def _build_peak_shaving_reason(row: dict[str, Any], inference: dict[str, Any], actions: dict[str, float] | None) -> str:
    stress = _num(row, "grid_stress_index")
    peak_penalty = _num(row, "peak_penalty")
    factor = (actions or {}).get("peak_shaving_factor", 0)
    load = _num(row, "grid_load_kw")

    if factor > 0.35 or peak_penalty > 0.4 or stress > STRESS_HIGH:
        return (
            "Peak shaving activated to prevent overload during projected demand spike. "
            f"{inference.get('peak_shaving_action', '')} "
            f"(factor {factor:.2f}, load {load:.0f} kW)."
        )
    return inference.get("peak_shaving_action", "Peak shaving on standby — demand within envelope.")


def _build_confidence_reasoning(
    row: dict[str, Any],
    inference: dict[str, Any],
    contributions: list[dict[str, Any]],
) -> str:
    conf = float(inference.get("confidence_score", 0.65))
    stress = _num(row, "grid_stress_index")
    anomaly = _num(row, "anomaly_score")
    renewable = _num(row, "renewable_ratio")

    factors_up: list[str] = []
    factors_down: list[str] = []

    if renewable >= RENEWABLE_TARGET:
        factors_up.append("strong renewable signal")
    if stress < 0.4:
        factors_up.append("low grid stress")
    if stress > 0.65:
        factors_down.append("elevated stress uncertainty")
    if anomaly > 2:
        factors_down.append("anomalous load pattern")

    high_drivers = [c["factor"] for c in contributions if c.get("impact") == "high"]
    if high_drivers:
        factors_down.append(f"high-sensitivity inputs ({', '.join(high_drivers[:2])})")

    parts = [f"Confidence {conf * 100:.1f}%"]
    if factors_up:
        parts.append(f"boosted by {', '.join(factors_up)}")
    if factors_down:
        parts.append(f"reduced by {', '.join(factors_down)}")
    return " — ".join(parts) + "."


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


@dataclass
class GridExplanation:
    summary: str
    reasoning: str
    risk_analysis: str
    renewable_strategy: str
    battery_strategy: str
    peak_shaving_reason: str
    confidence_reasoning: str
    priority_factors: list[str] = field(default_factory=list)
    contributions: list[dict[str, Any]] = field(default_factory=list)
    priorities: list[dict[str, Any]] = field(default_factory=list)
    action_interpretations: list[dict[str, Any]] = field(default_factory=list)
    safety: dict[str, Any] = field(default_factory=dict)
    reward_components: dict[str, float] = field(default_factory=dict)
    risks_mitigated: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def build_explanation(
    row: dict[str, Any],
    inference: dict[str, Any],
    *,
    ddpg_actions: dict[str, float] | None = None,
    policy_source: str = "rule_engine",
) -> dict[str, Any]:
    """
    Full XAI payload for ``GET /ai/inference``.

    Parameters
    ----------
    row : latest telemetry dict
    inference : GridInferenceResult.to_dict() or compatible
    ddpg_actions : named DDPG actor outputs (if available)
    policy_source : ``ddpg_telemetry_actor`` | ``rule_engine``
    """
    actions = ddpg_actions or inference.get("ddpg_actions") or inference.get("actions")
    reward_components = compute_reward_components(row)

    # Merge RL training-style breakdown proxy from telemetry + actions
    reward_breakdown = {
        **reward_components,
        "rl_signal": _num(row, "rl_reward_signal"),
        "peak_penalty": _num(row, "peak_penalty"),
        "renewable_ratio": _num(row, "renewable_ratio"),
    }

    contributions = compute_contributions(row, actions)
    priorities = rank_optimization_priorities(row, actions, reward_components)
    action_interpretations = interpret_all_actions(actions)
    safety = build_safety_explanations(row, actions)

    priority_factors = [p["label"] for p in priorities if p.get("active")][:5]
    if not priority_factors and priorities:
        priority_factors = [priorities[0]["label"]]

    risks_mitigated = [
        item["category"].replace("_", " ")
        for item in safety.get("items", [])
        if item.get("severity") in ("high", "critical")
    ]

    explanation = GridExplanation(
        summary=_build_summary(row, inference, actions, priorities),
        reasoning=_build_reasoning(row, contributions, action_interpretations),
        risk_analysis=_build_risk_analysis(row, inference),
        renewable_strategy=_build_renewable_strategy(row, inference, actions),
        battery_strategy=_build_battery_strategy(row, inference, actions),
        peak_shaving_reason=_build_peak_shaving_reason(row, inference, actions),
        confidence_reasoning=_build_confidence_reasoning(row, inference, contributions),
        priority_factors=priority_factors,
        contributions=contributions,
        priorities=priorities,
        action_interpretations=action_interpretations,
        safety=safety,
        reward_components=reward_breakdown,
        risks_mitigated=risks_mitigated,
    )

    payload = explanation.to_dict()
    payload["policy_source"] = policy_source
    payload["telemetry_snapshot"] = {
        name: round(_num(row, name), 4) if name != "soc_percent" else round(_num(row, name), 1)
        for name in STATE_FEATURE_NAMES
    }
    return payload


def attach_explanation_to_inference(
    row: dict[str, Any],
    inference: dict[str, Any],
    *,
    ddpg_actions: dict[str, float] | None = None,
    policy_source: str = "rule_engine",
) -> dict[str, Any]:
    """Merge explainability into inference response (mutates copy)."""
    out = dict(inference)
    out["explainability"] = build_explanation(
        row,
        inference,
        ddpg_actions=ddpg_actions,
        policy_source=policy_source,
    )
    # Enrich top-level narrative when DDPG provides richer reasoning
    xai = out["explainability"]
    if xai.get("summary"):
        out["ai_reasoning"] = xai["reasoning"]
    return out
