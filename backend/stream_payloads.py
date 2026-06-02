"""
Build real-time stream payloads for WebSocket broadcast (telemetry, AI, forecast).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from backend.explainability import attach_explanation_to_inference
from backend.forecasting import forecasting_engine
from backend.grid_intelligence import grid_intelligence
from backend.rl_interfaces import policy_integration_payload


def _utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_telemetry_payload(
    rows: list[dict[str, Any]],
    tick_index: int,
    *,
    include_full_rows: bool = True,
) -> dict[str, Any]:
    """Telemetry snapshot for /ws/telemetry."""
    if not rows:
        return {
            "type": "telemetry",
            "event": "empty",
            "timestamp": _utc_iso(),
            "tick_index": 0,
            "data": {"rows": [], "latest": None, "row_count": 0},
        }

    idx = tick_index % len(rows)
    latest = rows[idx]

    if include_full_rows:
        window_end = idx + 1
        window_start = max(0, window_end - 1000)
        visible = rows[window_start:window_end]
        data: dict[str, Any] = {
            "rows": visible,
            "latest": latest,
            "row_count": len(rows),
            "stream_index": idx,
            "timestamp": latest.get("timestamp"),
        }
        event = "snapshot"
    else:
        data = {
            "latest": latest,
            "row_count": len(rows),
            "stream_index": idx,
            "timestamp": latest.get("timestamp"),
        }
        event = "tick"

    return {
        "type": "telemetry",
        "event": event,
        "timestamp": _utc_iso(),
        "tick_index": idx,
        "seq": tick_index,
        "data": data,
    }


def build_ai_payload(rows: list[dict[str, Any]], tick_index: int) -> dict[str, Any]:
    """AI ops bundle for /ws/ai — inference, fleet, alerts, activities, events."""
    if not rows:
        return {
            "type": "ai",
            "event": "empty",
            "timestamp": _utc_iso(),
            "data": {},
        }

    idx = tick_index % len(rows)
    latest = rows[idx]
    history = rows[max(0, idx - 48) : idx + 1]

    result = grid_intelligence.analyze_row(latest, history)
    payload = result.to_dict()
    payload["rl"] = policy_integration_payload(latest)
    policy = grid_intelligence._get_ddpg_policy()
    if policy is not None:
        rl = policy.predict(latest)
        payload["ddpg_actions"] = rl.get("actions", {})
        payload["policy_source"] = "ddpg_telemetry_actor"
    else:
        payload["policy_source"] = "rule_engine"

    if not payload.get("explainability"):
        payload = attach_explanation_to_inference(
            latest,
            payload,
            ddpg_actions=payload.get("ddpg_actions"),
            policy_source=payload.get("policy_source", "rule_engine"),
        )

    alerts = grid_intelligence.generate_alerts(latest, rows[max(0, idx - 72) : idx + 1])
    activities = grid_intelligence.generate_activities(latest, history, result)
    fleet = grid_intelligence.generate_fleet(latest)

    events = _derive_realtime_events(latest, history, payload, alerts)

    return {
        "type": "ai",
        "event": "update",
        "timestamp": _utc_iso(),
        "tick_index": idx,
        "seq": tick_index,
        "data": {
            "inference": payload,
            "fleet": fleet,
            "alerts": alerts,
            "activities": activities,
            "decisions": payload.get("decisions", []),
            "events": events,
        },
    }


def build_forecast_payload(
    rows: list[dict[str, Any]],
    tick_index: int,
    *,
    horizon: int = 6,
    window: int = 24,
) -> dict[str, Any]:
    """Forecast bundle for /ws/forecast."""
    if not rows:
        return {
            "type": "forecast",
            "event": "empty",
            "timestamp": _utc_iso(),
            "data": {},
        }

    idx = tick_index % len(rows)
    context_rows = rows[: idx + 1]
    bundle = forecasting_engine.forecast_safe(context_rows, horizon=horizon, window=window)
    summary = forecasting_engine.summary_metrics(context_rows)

    return {
        "type": "forecast",
        "event": "update",
        "timestamp": _utc_iso(),
        "tick_index": idx,
        "seq": tick_index,
        "data": {
            **bundle.to_dict(),
            "summary": summary,
        },
    }


def _derive_realtime_events(
    latest: dict[str, Any],
    history: list[dict[str, Any]],
    inference: dict[str, Any],
    alerts: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Compact real-time event feed for dashboard pulse / notifications."""
    events: list[dict[str, Any]] = []
    ts = _utc_iso()

    def add(etype: str, title: str, detail: str, severity: str = "medium") -> None:
        events.append(
            {
                "type": etype,
                "title": title,
                "detail": detail,
                "severity": severity,
                "timestamp": ts,
            }
        )

    stress = float(latest.get("grid_stress_index", 0))
    renewable = float(latest.get("renewable_ratio", 0))
    peak_penalty = float(latest.get("peak_penalty", 0))

    add(
        "ddpg_decision",
        "DDPG optimization cycle",
        inference.get("ai_recommendation", "Policy update"),
        inference.get("risk_level", "medium"),
    )

    if stress > 0.55:
        add(
            "overload_warning",
            "Grid stress elevated",
            f"Stress index {(stress * 100):.0f}% — peak shaving recommended.",
            "critical" if stress > 0.72 else "high",
        )

    if peak_penalty > 0.35:
        add(
            "peak_alert",
            "Peak demand risk",
            f"Peak penalty {(peak_penalty * 100):.0f}% on current load.",
            "high",
        )

    if len(history) >= 2:
        prev_r = float(history[-2].get("renewable_ratio", 0))
        if renewable - prev_r > 0.05:
            add(
                "renewable_shift",
                "Renewable contribution rising",
                f"Mix shifted to {(renewable * 100):.0f}% (+{((renewable - prev_r) * 100):.0f}%).",
                "medium",
            )

    for alert in alerts[:3]:
        events.append(
            {
                "type": "risk_alert",
                "title": alert.get("title", "Alert"),
                "detail": alert.get("message", ""),
                "severity": alert.get("severity", "medium"),
                "timestamp": alert.get("timestamp", ts),
            }
        )

    return events[:8]
