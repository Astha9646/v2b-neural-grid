"""
Grid operations intelligence engine — telemetry-driven AI for V2B Neural Grid.

Complements ``backend.inference`` (DDPG actor). This module reasons over live
smart-grid telemetry and produces operational decisions, fleet views, alerts,
and activity events for the command-center dashboard.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any

import numpy as np


def _num(row: dict[str, Any] | None, key: str, default: float = 0.0) -> float:
    if not row:
        return default
    try:
        v = float(row.get(key, default))
        return v if np.isfinite(v) else default
    except (TypeError, ValueError):
        return default


def _clamp(v: float, lo: float, hi: float) -> float:
    return float(np.clip(v, lo, hi))


def _risk_level(stress: float, anomaly: float, peak_penalty: float) -> str:
    score = stress * 0.45 + min(anomaly / 5.0, 1.0) * 0.35 + peak_penalty * 0.2
    if score >= 0.72:
        return "critical"
    if score >= 0.52:
        return "high"
    if score >= 0.32:
        return "medium"
    return "low"


@dataclass
class GridInferenceResult:
    optimization_action: str
    risk_level: str
    charging_strategy: str
    renewable_strategy: str
    thermal_protection_action: str
    battery_protection_action: str
    peak_shaving_action: str
    grid_balancing_action: str
    ai_recommendation: str
    ai_reasoning: str
    confidence_score: float
    decisions: list[dict[str, Any]] = field(default_factory=list)
    timestamp: str = ""
    explainability: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class GridIntelligenceEngine:
    """Rule-based + DDPG policy intelligence over telemetry streams."""

    RENEWABLE_TARGET = 0.35
    PEAK_STRESS_THRESHOLD = 0.55
    THERMAL_WARN_C = 38.0
    THERMAL_CRIT_C = 42.0

    def __init__(self) -> None:
        self._ddpg_policy = None
        self._ddpg_init_attempted = False

    def _get_ddpg_policy(self):
        if self._ddpg_init_attempted:
            return self._ddpg_policy
        self._ddpg_init_attempted = True
        try:
            from backend.rl.policy import get_telemetry_policy

            policy = get_telemetry_policy()
            if policy.is_loaded:
                self._ddpg_policy = policy
        except Exception as exc:
            import logging

            logging.getLogger(__name__).warning("DDPG policy unavailable: %s", exc)
        return self._ddpg_policy

    def analyze_row(
        self,
        row: dict[str, Any],
        history: list[dict[str, Any]] | None = None,
    ) -> GridInferenceResult:
        history = history or []
        policy = self._get_ddpg_policy()
        if policy is not None:
            rl = policy.predict(row)
            result = self._analyze_with_ddpg(row, history, policy, rl=rl)
            return self._attach_explainability(row, result, rl.get("actions"))
        result = self._analyze_rule_based(row, history)
        return self._attach_explainability(row, result, None)

    def _attach_explainability(
        self,
        row: dict[str, Any],
        result: GridInferenceResult,
        ddpg_actions: dict[str, float] | None,
    ) -> GridInferenceResult:
        """Attach XAI payload to inference result."""
        try:
            from backend.explainability import build_explanation

            policy_source = "ddpg_telemetry_actor" if ddpg_actions else "rule_engine"
            result.explainability = build_explanation(
                row,
                result.to_dict(),
                ddpg_actions=ddpg_actions,
                policy_source=policy_source,
            )
            if result.explainability.get("reasoning"):
                result.ai_reasoning = result.explainability["reasoning"]
        except Exception as exc:
            import logging

            logging.getLogger(__name__).warning("Explainability generation failed: %s", exc)
        return result

    def _analyze_with_ddpg(
        self,
        row: dict[str, Any],
        history: list[dict[str, Any]] | None,
        policy: Any,
        rl: dict[str, Any] | None = None,
    ) -> GridInferenceResult:
        """Blend trained DDPG actor outputs with rule-based safety overlays."""
        rl = rl or policy.predict(row)
        rule = self._analyze_rule_based(row, history)

        stress = _num(row, "grid_stress_index")
        thermal = _num(row, "thermal_index")
        degradation = _num(row, "degradation_score")

        thermal_action = rule.thermal_protection_action
        if thermal >= self.THERMAL_CRIT_C:
            thermal_action = rule.thermal_protection_action
        elif thermal < self.THERMAL_WARN_C:
            thermal_action = rl.get("thermal_protection_action", thermal_action)

        battery_action = rule.battery_protection_action
        if degradation > 8:
            battery_action = rule.battery_protection_action
        else:
            battery_action = rl.get("battery_protection_action", battery_action)

        confidence = _clamp(
            (float(rl.get("confidence_score", 0.7)) + rule.confidence_score) / 2.0,
            0.55,
            0.98,
        )

        decisions = self._build_decisions(
            row,
            rl.get("risk_level", rule.risk_level),
            rl.get("ai_recommendation", rule.ai_recommendation),
            f"{rl.get('ai_reasoning', '')} | Rules: {rule.ai_reasoning}",
            confidence,
            rl.get("optimization_action", rule.optimization_action),
        )

        ts = str(row.get("timestamp") or datetime.now(timezone.utc).isoformat())
        return GridInferenceResult(
            optimization_action=rl.get("optimization_action", rule.optimization_action),
            risk_level=rl.get("risk_level", rule.risk_level),
            charging_strategy=rl.get("charging_strategy", rule.charging_strategy),
            renewable_strategy=rl.get("renewable_strategy", rule.renewable_strategy),
            thermal_protection_action=thermal_action,
            battery_protection_action=battery_action,
            peak_shaving_action=rl.get("peak_shaving_action", rule.peak_shaving_action),
            grid_balancing_action=rl.get("grid_balancing_action", rule.grid_balancing_action),
            ai_recommendation=rl.get("ai_recommendation", rule.ai_recommendation),
            ai_reasoning=rl.get("ai_reasoning", rule.ai_reasoning),
            confidence_score=round(confidence, 4),
            decisions=decisions,
            timestamp=ts,
        )

    def _analyze_rule_based(
        self,
        row: dict[str, Any],
        history: list[dict[str, Any]] | None = None,
    ) -> GridInferenceResult:
        history = history or []
        load = _num(row, "grid_load_kw")
        soc = _num(row, "soc_percent")
        renewable = _num(row, "renewable_ratio")
        thermal = _num(row, "thermal_index")
        stress = _num(row, "grid_stress_index")
        anomaly = _num(row, "anomaly_score")
        util = _num(row, "charger_utilization")
        degradation = _num(row, "degradation_score")
        peak_penalty = _num(row, "peak_penalty")
        peak_kw = _num(row, "peak_demand_kw", load)
        reward = _num(row, "rl_reward_signal")
        charging_stress = _num(row, "charging_stress_score")
        solar = _num(row, "solar_generation_kw")
        peak_risk = _num(row, "predicted_peak_risk")

        risk = _risk_level(stress, anomaly, peak_penalty)

        if peak_penalty > 0.5 or stress > 0.6:
            optimization_action = "peak_shave_and_cap_charging"
            peak_shaving = (
                f"Enable V2B discharge up to {max(8, int(load * 0.12))} kW; "
                f"cap aggregate charging at {int(peak_kw * 0.92)} kW."
            )
            charging_strategy = "defer_discretionary_sessions"
        elif renewable < self.RENEWABLE_TARGET and solar < 15:
            optimization_action = "renewable_priority_dispatch"
            peak_shaving = "hold_v2b_export_until solar window improves"
            charging_strategy = "shift_load_to_solar_hours"
        elif soc >= 88:
            optimization_action = "soc_guard_and_trickle"
            peak_shaving = "no_additional_discharge required"
            charging_strategy = "reduce_setpoints_prevent_overcharge"
        elif reward < -0.1:
            optimization_action = "rl_reward_recovery"
            peak_shaving = "apply_moderate_peak_mask"
            charging_strategy = "rebalance_charger_weights"
        else:
            optimization_action = "steady_state_tracking"
            peak_shaving = "monitor_only"
            charging_strategy = "maintain_heterogeneous_setpoints"

        if renewable >= self.RENEWABLE_TARGET:
            renewable_strategy = f"maximize_solar_offset ({renewable * 100:.0f}% renewable)"
        elif solar > 20:
            renewable_strategy = "route_excess_pv_to_building_and_l2"
        else:
            renewable_strategy = "limit_dc_fast_prioritize_stored_energy"

        if thermal >= self.THERMAL_CRIT_C:
            thermal_action = f"emergency_throttle_fast_charge; cell index {thermal:.1f}°C"
        elif thermal >= self.THERMAL_WARN_C:
            thermal_action = f"reduce_dc_ramp_15pct; monitor thermal_index {thermal:.1f}°C"
        else:
            thermal_action = "thermal_nominal"

        if degradation > 8 or charging_stress > 70:
            battery_action = "enable_battery_protection_mask; limit deep cycles"
        elif soc >= 90:
            battery_action = "clamp_upper_soc_band"
        else:
            battery_action = "standard_soh_preservation"

        grid_balancing = (
            f"Balance {load:.1f} kW load across {max(1, int(util * 8))} active EVs; "
            f"utilization {util * 100:.0f}%."
        )

        ai_recommendation = self._primary_recommendation(
            risk, load, renewable, peak_penalty, anomaly, reward
        )
        ai_reasoning = (
            f"Stress {stress:.2f}, anomaly {anomaly:.2f}, peak risk {peak_risk:.2f}, "
            f"RL signal {reward:.3f}, renewable {renewable:.2f}. "
            f"Strategy: {optimization_action}."
        )
        confidence = _clamp(
            0.62
            + (1.0 - min(stress, 1.0)) * 0.15
            + min(renewable, 1.0) * 0.1
            - min(anomaly / 10.0, 0.2),
            0.55,
            0.98,
        )

        decisions = self._build_decisions(
            row, risk, ai_recommendation, ai_reasoning, confidence, optimization_action
        )

        ts = str(row.get("timestamp") or datetime.now(timezone.utc).isoformat())

        return GridInferenceResult(
            optimization_action=optimization_action,
            risk_level=risk,
            charging_strategy=charging_strategy,
            renewable_strategy=renewable_strategy,
            thermal_protection_action=thermal_action,
            battery_protection_action=battery_action,
            peak_shaving_action=peak_shaving,
            grid_balancing_action=grid_balancing,
            ai_recommendation=ai_recommendation,
            ai_reasoning=ai_reasoning,
            confidence_score=round(confidence, 4),
            decisions=decisions,
            timestamp=ts,
        )

    def _primary_recommendation(
        self,
        risk: str,
        load: float,
        renewable: float,
        peak_penalty: float,
        anomaly: float,
        reward: float,
    ) -> str:
        if risk == "critical":
            return (
                f"Immediate peak intervention on {load:.0f} kW load — "
                "activate V2B discharge and fleet cap."
            )
        if peak_penalty > 0.4:
            return f"Pre-empt peak window: shave ~{int(load * 0.1)} kW before demand crest."
        if anomaly > 2.0:
            return "Investigate anomalous load spike; validate concurrent charger sessions."
        if renewable < 0.2:
            return "Shift discretionary charging to next high-irradiance window."
        if reward > 0.15:
            return "RL policy aligned — continue current heterogeneous dispatch."
        return "Maintain DDPG tracking with periodic mask validation."

    def _build_decisions(
        self,
        row: dict[str, Any],
        risk: str,
        recommendation: str,
        reasoning: str,
        confidence: float,
        action: str,
    ) -> list[dict[str, Any]]:
        ts = str(row.get("timestamp") or datetime.now(timezone.utc).isoformat())
        load = _num(row, "grid_load_kw")
        decisions = [
            {
                "id": "ai-primary",
                "title": recommendation[:80] + ("…" if len(recommendation) > 80 else ""),
                "severity": risk if risk != "low" else "medium",
                "timestamp": ts,
                "recommendation": recommendation,
                "reasoning": reasoning,
                "source": f"Grid Intelligence · {action}",
                "confidence": confidence,
                "status": "active",
                "optimization_action": action,
                "risk_level": risk,
                "charging_strategy": action,
                "mitigation_actions": [],
            }
        ]

        stress = _num(row, "grid_stress_index")
        if stress > 0.5:
            decisions.append(
                {
                    "id": "grid-stress",
                    "title": "Grid stress elevated",
                    "severity": "high" if stress > 0.65 else "medium",
                    "timestamp": ts,
                    "recommendation": (
                        f"Reduce non-critical charging by {int(load * 0.06)} kW; "
                        f"stress index {(stress * 100):.0f}%."
                    ),
                    "reasoning": reasoning,
                    "source": "grid_stress_index",
                    "confidence": min(0.97, confidence + 0.02),
                    "status": "active",
                    "risk_level": risk,
                }
            )

        return decisions[:6]

    def generate_fleet(self, row: dict[str, Any]) -> list[dict[str, Any]]:
        """Build 8-vehicle fleet snapshot from latest telemetry + charger streams."""
        util = _clamp(_num(row, "charger_utilization"), 0, 1)
        base_soc = _num(row, "soc_percent", 50)
        base_health = _num(row, "battery_health_percent", 90)
        base_stress = _num(row, "charging_stress_score", 40)
        base_thermal = _num(row, "thermal_index", 30)
        renewable = _num(row, "renewable_ratio")
        load = _num(row, "grid_load_kw")
        stress = _num(row, "grid_stress_index")

        chargers = [
            ("A", "chargerA", "Station A · L2"),
            ("B", "chargerB", "Station B · L2"),
            ("C", "chargerC", "Station C · DC Fast"),
            ("D", "chargerD", "Station D · V2B"),
        ]

        fleet: list[dict[str, Any]] = []
        active_slots = max(1, round(util * 8))

        for i in range(8):
            ev_id = f"EV-{i + 1:03d}"
            ch_idx = i % 4
            ch_key, ch_col, ch_label = chargers[ch_idx]
            power = _num(row, ch_col) if ch_col in row else _num(row, "charging_power_kw") / 4

            soc_delta = (i - 3.5) * 4.2
            soc = _clamp(base_soc + soc_delta + (power * 0.08), 0, 100)
            health = _clamp(base_health + (2 if i % 3 == 0 else -1) - i * 0.3, 70, 99)
            stress_score = _clamp(base_stress + (i % 4) * 8 - 6, 5, 98)
            thermal = _clamp(base_thermal + (i % 3) * 2.5 - 2, 22, 48)

            if i >= active_slots and abs(power) < 0.5:
                fleet_status, charging_state, power = "Idle", "idle", 0.0
            elif power < -2:
                fleet_status, charging_state = "Peak Reduction", "v2b_discharge"
            elif renewable > 0.4 and power > 2:
                fleet_status, charging_state = "Renewable Optimized", "solar_priority"
            elif thermal >= self.THERMAL_WARN_C:
                fleet_status, charging_state = "Thermal Warning", "thermal_limited"
            elif soc >= 92 and power > 0:
                fleet_status, charging_state = "Battery Protection", "trickle"
            elif stress > 0.55 and i % 2 == 0:
                fleet_status, charging_state = "Peak Reduction", "load_capped"
            elif power > 1:
                fleet_status, charging_state = "Charging", "active_charge"
            else:
                fleet_status, charging_state = "Idle", "idle"

            remaining_kwh = max(0, (90 - soc) / 100 * 60)
            eta_h = remaining_kwh / max(power, 3.5) if power > 0.5 else 0
            eta = (
                datetime.now(timezone.utc).isoformat()
                if eta_h <= 0
                else f"{int(eta_h)}h {int((eta_h % 1) * 60)}m"
            )

            grid_impact = _clamp(stress * 0.5 + (power / max(load, 1)) * 0.4, 0, 1)

            fleet.append(
                {
                    "evId": ev_id,
                    "stationId": f"CHG-{ch_key}",
                    "charger": ch_label,
                    "soc": round(soc, 1),
                    "power": round(power, 2),
                    "health": round(health, 1),
                    "chargingStress": round(stress_score, 1),
                    "thermalStatus": (
                        "critical"
                        if thermal >= self.THERMAL_CRIT_C
                        else "elevated"
                        if thermal >= self.THERMAL_WARN_C
                        else "normal"
                    ),
                    "thermalC": round(thermal, 1),
                    "fleetStatus": fleet_status,
                    "estimatedCompletion": eta if isinstance(eta, str) and "T" not in eta else "—",
                    "chargingState": charging_state,
                    "renewableContribution": round(renewable * (100 if power > 0 else 0), 1),
                    "gridImpactScore": round(grid_impact * 100, 1),
                    "priority": (
                        "critical"
                        if fleet_status == "Thermal Warning"
                        else "high"
                        if fleet_status in ("Peak Reduction", "Battery Protection")
                        else "normal"
                    ),
                    "status": charging_state.replace("_", "-") if charging_state else "idle",
                }
            )

        return fleet

    def generate_alerts(
        self,
        row: dict[str, Any],
        history: list[dict[str, Any]] | None = None,
    ) -> list[dict[str, Any]]:
        history = history or []
        ts = str(row.get("timestamp") or datetime.now(timezone.utc).isoformat())
        alerts: list[dict[str, Any]] = []

        def add(
            aid: str,
            title: str,
            message: str,
            severity: str,
            source: str,
            icon: str,
        ) -> None:
            alerts.append(
                {
                    "id": aid,
                    "title": title,
                    "message": message,
                    "severity": severity,
                    "timestamp": ts,
                    "source": source,
                    "icon": icon,
                    "unread": severity in ("critical", "high"),
                }
            )

        load = _num(row, "grid_load_kw")
        peak = _num(row, "peak_demand_kw", load)
        stress = _num(row, "grid_stress_index")
        anomaly = _num(row, "anomaly_score")
        thermal = _num(row, "thermal_index")
        renewable = _num(row, "renewable_ratio")
        degradation = _num(row, "degradation_score")
        c_stress = _num(row, "charging_stress_score")
        util = _num(row, "charger_utilization")
        reward = _num(row, "rl_reward_signal")

        if stress > 0.55 or load >= peak * 0.95:
            add(
                "peak-demand",
                "Peak demand approaching threshold",
                f"Grid load {load:.1f} kW vs peak {peak:.1f} kW — stress {(stress * 100):.0f}%.",
                "critical" if stress > 0.7 else "high",
                "Grid · Peak Demand",
                "peak",
            )

        if renewable < self.RENEWABLE_TARGET:
            add(
                "renewable-low",
                "Renewable contribution below target",
                f"Renewable ratio {(renewable * 100):.0f}% below {self.RENEWABLE_TARGET * 100:.0f}% target.",
                "high" if renewable < 0.15 else "medium",
                "Solar · Renewable Mix",
                "solar",
            )

        if thermal >= self.THERMAL_WARN_C:
            add(
                "thermal-stress",
                "Thermal stress detected on fleet",
                f"Fleet thermal index {thermal:.1f}°C — throttle DC fast sessions.",
                "critical" if thermal >= self.THERMAL_CRIT_C else "high",
                "Fleet · Thermal",
                "thermal",
            )

        if anomaly > 1.5:
            add(
                "grid-anomaly",
                "Grid anomaly detected",
                f"Anomaly score {anomaly:.2f} exceeds rolling baseline.",
                "critical" if anomaly > 3 else "high",
                "AI · Anomaly Detection",
                "peak",
            )

        if degradation > 7:
            add(
                "degradation",
                "Battery degradation accelerating",
                f"Degradation proxy {degradation:.1f}%/yr equivalent — review V2B depth.",
                "medium",
                "Battery · SOH",
                "info",
            )

        if util > 0.85 and c_stress > 60:
            add(
                "charger-overload",
                "Charger overload warning",
                f"Utilization {(util * 100):.0f}% with stress {c_stress:.0f}.",
                "high",
                "Fleet · Chargers",
                "delay",
            )

        if reward < -0.15 or _num(row, "peak_penalty") > 0.45:
            add(
                "rl-intervention",
                "RL optimization intervention triggered",
                f"rl_reward_signal {reward:.3f} — policy adjusting masks.",
                "medium",
                "RL · DDPG",
                "v2b",
            )

        alerts.sort(
            key=lambda a: {"critical": 0, "high": 1, "medium": 2, "low": 3}.get(
                a["severity"], 9
            )
        )
        return alerts[:12]

    def generate_activities(
        self,
        row: dict[str, Any],
        history: list[dict[str, Any]] | None = None,
        inference: GridInferenceResult | None = None,
    ) -> list[dict[str, Any]]:
        history = history or []
        ts = str(row.get("timestamp") or datetime.now(timezone.utc).isoformat())
        events: list[dict[str, Any]] = []

        def evt(eid: str, etype: str, title: str, detail: str, actor: str, offset_min: int = 0) -> None:
            events.append(
                {
                    "id": eid,
                    "type": etype,
                    "title": title,
                    "detail": detail,
                    "timestamp": ts,
                    "actor": actor,
                    "sortKey": offset_min,
                }
            )

        if inference:
            evt(
                "opt-cycle",
                "optimization",
                "AI optimization cycle completed",
                inference.ai_recommendation,
                "Grid Intelligence",
                0,
            )

        stress = _num(row, "grid_stress_index")
        load = _num(row, "grid_load_kw")
        renewable = _num(row, "renewable_ratio")
        reward = _num(row, "rl_reward_signal")
        peak_penalty = _num(row, "peak_penalty")

        if peak_penalty > 0.35:
            evt(
                "peak-shave",
                "mask",
                "Peak shaving initiated",
                f"Peak penalty {(peak_penalty * 100):.0f}% on {load:.0f} kW load.",
                "Action Mask",
                1,
            )

        if renewable > 0.35:
            evt(
                "renewable-balance",
                "forecast",
                "Renewable balancing activated",
                f"Renewable ratio {(renewable * 100):.0f}% — solar priority dispatch.",
                "Renewable Controller",
                2,
            )

        if _num(row, "charging_power_kw") > 5 and len(history) >= 2:
            prev = _num(history[-2], "charging_power_kw")
            cur = _num(row, "charging_power_kw")
            if abs(cur - prev) > 8:
                evt(
                    "load-redist",
                    "reassign",
                    "Charging load redistributed",
                    f"Fleet power shifted {prev:.1f} → {cur:.1f} kW.",
                    "Fleet Scheduler",
                    3,
                )

        if _num(row, "thermal_index") >= self.THERMAL_WARN_C:
            evt(
                "thermal-mit",
                "delay",
                "Battery thermal mitigation enabled",
                f"Thermal index {_num(row, 'thermal_index'):.1f}°C.",
                "Thermal Guard",
                4,
            )

        if reward > 0.1 and len(history) >= 3:
            prev_r = _num(history[-3], "rl_reward_signal")
            if reward > prev_r + 0.05:
                evt(
                    "rl-improve",
                    "optimization",
                    "RL reward improved",
                    f"Signal {prev_r:.3f} → {reward:.3f}.",
                    "DDPG Policy",
                    5,
                )

        if stress < 0.4 and len(history) >= 2 and _num(history[-2], "grid_stress_index") > 0.55:
            evt(
                "stress-norm",
                "session",
                "Grid stress normalized",
                f"Stress index now {(stress * 100):.0f}%.",
                "Grid Monitor",
                6,
            )

        util = _num(row, "charger_utilization")
        if util > 0.5:
            evt(
                "fleet-sync",
                "reassign",
                "Fleet charging synchronized",
                f"{max(1, int(util * 8))} vehicles coordinated on heterogeneous chargers.",
                "Fleet Ops",
                7,
            )

        events.sort(key=lambda e: e.get("sortKey", 0))
        return events[:10]


# Singleton for API routes
grid_intelligence = GridIntelligenceEngine()
