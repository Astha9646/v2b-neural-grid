"""
Enterprise report generation for V2B Neural Grid.

Produces CSV and PDF exports for telemetry, AI decisions, forecasts, and
full executive summaries (RL metrics, explainability, renewable/battery analytics).
"""

from __future__ import annotations

import csv
import io
import json
import logging
from datetime import datetime, timezone
from typing import Any, Literal

import pandas as pd

from backend.config import settings
from backend.forecasting import forecasting_engine
from backend.grid_intelligence import grid_intelligence
from backend.inference import model_service
from backend.telemetry_loader import load_telemetry_rows

logger = logging.getLogger(__name__)

ExportFormat = Literal["csv", "pdf"]


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        v = float(value)
        return v if pd.notna(v) else default
    except (TypeError, ValueError):
        return default


def _series_stats(rows: list[dict[str, Any]], key: str, alt: str | None = None) -> dict[str, float]:
    vals = []
    for row in rows:
        raw = row.get(key, row.get(alt) if alt else None)
        if raw is not None:
            vals.append(_safe_float(raw))
    if not vals:
        return {"min": 0.0, "max": 0.0, "avg": 0.0, "latest": 0.0}
    return {
        "min": round(min(vals), 2),
        "max": round(max(vals), 2),
        "avg": round(sum(vals) / len(vals), 2),
        "latest": round(vals[-1], 2),
    }


class ReportGenerator:
    """Collects platform data and renders enterprise export artifacts."""

    def __init__(self, row_limit: int | None = None) -> None:
        self.row_limit = row_limit or settings.telemetry_row_limit

    def load_rows(self) -> list[dict[str, Any]]:
        return load_telemetry_rows(limit=self.row_limit)

    def collect_enterprise_payload(self) -> dict[str, Any]:
        rows = self.load_rows()
        latest = rows[-1] if rows else {}
        history = rows[-48:] if rows else []

        inference: dict[str, Any] = {}
        if rows:
            try:
                result = grid_intelligence.analyze_row(latest, history)
                inference = result.to_dict()
            except Exception as exc:
                logger.warning("Report inference collection failed: %s", exc)
                inference = {"error": str(exc), "fallback": True}

        forecast_bundle = forecasting_engine.forecast_safe(rows) if rows else forecasting_engine.fallback_bundle()
        forecast_dict = forecast_bundle.to_dict()
        forecast_summary = (
            forecasting_engine.summary_metrics(rows)
            if rows
            else {"load_trend_1h": 0, "load_ma_24": 0, "load_forecast_next": 0}
        )

        rl_metrics = model_service.get_metrics()

        decisions = inference.get("decisions") or []
        explainability = inference.get("explainability") or {}

        renewable = {
            "solar_kw": _series_stats(rows, "solar_generation_kw", "solar_kw"),
            "renewable_ratio": _series_stats(rows, "renewable_ratio"),
            "renewable_utilization": _series_stats(rows, "renewable_utilization_score"),
            "carbon_savings_kg": _series_stats(rows, "carbon_savings_kg"),
        }

        battery = {
            "soc_percent": _series_stats(rows, "soc_percent", "soc"),
            "battery_health_percent": _series_stats(rows, "battery_health_percent"),
            "degradation_score": _series_stats(rows, "degradation_score"),
            "battery_risk_level": _series_stats(rows, "battery_risk_level"),
            "thermal_index": _series_stats(rows, "thermal_index"),
        }

        telemetry_summary = {
            "grid_load_kw": _series_stats(rows, "grid_load_kw", "load"),
            "charging_power_kw": _series_stats(rows, "charging_power_kw"),
            "peak_demand_kw": _series_stats(rows, "peak_demand_kw"),
            "grid_stress_index": _series_stats(rows, "grid_stress_index"),
            "anomaly_score": _series_stats(rows, "anomaly_score"),
        }

        xai_block = inference.get("explainability") or {}
        optimization = {
            "optimization_action": inference.get("optimization_action"),
            "charging_strategy": inference.get("charging_strategy"),
            "renewable_strategy": inference.get("renewable_strategy"),
            "peak_shaving_action": inference.get("peak_shaving_action"),
            "grid_balancing_action": inference.get("grid_balancing_action"),
            "confidence_score": inference.get("confidence_score"),
            "risk_level": inference.get("risk_level"),
            "policy_source": xai_block.get("policy_source") or inference.get("policy_source", "rule_engine"),
        }

        chart_series = self._build_chart_series(rows)

        return {
            "meta": {
                "title": "V2B Neural Grid — Enterprise Operations Report",
                "generated_at": _utc_now_iso(),
                "row_count": len(rows),
                "environment": settings.environment,
                "model_loaded": model_service.is_loaded,
            },
            "telemetry": {
                "summary": telemetry_summary,
                "chart_series": chart_series,
                "rows": rows,
            },
            "forecast": {
                "bundle": forecast_dict,
                "summary": forecast_summary,
            },
            "inference": inference,
            "decisions": decisions,
            "explainability": explainability,
            "renewable": renewable,
            "battery": battery,
            "optimization": optimization,
            "rl_metrics": rl_metrics,
        }

    def _build_chart_series(self, rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
        """Compact chart-ready series for PDF summaries (last 24 points)."""
        tail = rows[-24:] if rows else []
        load_series = []
        soc_series = []
        renewable_series = []
        for row in tail:
            ts = str(row.get("timestamp") or row.get("time") or "")
            load_series.append(
                {
                    "time": ts,
                    "load_kw": _safe_float(row.get("grid_load_kw", row.get("load"))),
                    "charging_kw": _safe_float(row.get("charging_power_kw")),
                }
            )
            soc_series.append(
                {
                    "time": ts,
                    "soc": _safe_float(row.get("soc_percent", row.get("soc"))),
                }
            )
            renewable_series.append(
                {
                    "time": ts,
                    "solar_kw": _safe_float(row.get("solar_generation_kw", row.get("solar_kw"))),
                    "renewable_ratio": _safe_float(row.get("renewable_ratio")),
                }
            )
        return {"load": load_series, "soc": soc_series, "renewable": renewable_series}

    # ------------------------------------------------------------------
    # CSV exporters
    # ------------------------------------------------------------------

    def telemetry_csv(self, rows: list[dict[str, Any]] | None = None) -> str:
        data = rows if rows is not None else self.load_rows()
        if not data:
            return "timestamp,message\n,No telemetry rows available\n"
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=list(data[0].keys()), extrasaction="ignore")
        writer.writeheader()
        writer.writerows(data)
        return buf.getvalue()

    def decisions_csv(self, payload: dict[str, Any] | None = None) -> str:
        payload = payload or self.collect_enterprise_payload()
        decisions = payload.get("decisions") or []
        inference = payload.get("inference") or {}
        buf = io.StringIO()
        if not decisions:
            buf.write("id,title,status,priority,summary\n")
            buf.write(f"0,Primary action,{inference.get('optimization_action','—')},active,high,\n")
            return buf.getvalue()
        fieldnames = sorted({k for d in decisions for k in d.keys()})
        writer = csv.DictWriter(buf, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in decisions:
            writer.writerow(row)
        return buf.getvalue()

    def forecast_csv(self, payload: dict[str, Any] | None = None) -> str:
        payload = payload or self.collect_enterprise_payload()
        bundle = payload.get("forecast", {}).get("bundle") or {}
        timestamps = bundle.get("timestamps") or [f"h+{i}" for i in range(bundle.get("horizon", 6))]
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(
            [
                "horizon",
                "timestamp",
                "load_kw",
                "peak_demand_kw",
                "renewable_kw",
                "soc_percent",
                "charging_demand_kw",
                "grid_stress_index",
            ]
        )
        keys = [
            "load_kw",
            "peak_demand_kw",
            "renewable_kw",
            "soc_percent",
            "charging_demand_kw",
            "grid_stress_index",
        ]
        for i, ts in enumerate(timestamps):
            writer.writerow(
                [i + 1, ts]
                + [round(_safe_float((bundle.get(k) or [0])[i] if i < len(bundle.get(k) or []) else 0), 3) for k in keys]
            )
        summary = payload.get("forecast", {}).get("summary") or {}
        writer.writerow([])
        writer.writerow(["summary_key", "value"])
        for k, v in summary.items():
            writer.writerow([k, v])
        return buf.getvalue()

    def enterprise_csv(self, payload: dict[str, Any] | None = None) -> str:
        payload = payload or self.collect_enterprise_payload()
        buf = io.StringIO()
        writer = csv.writer(buf)

        writer.writerow(["section", "metric", "value"])
        writer.writerow(["meta", "generated_at", payload["meta"]["generated_at"]])
        writer.writerow(["meta", "row_count", payload["meta"]["row_count"]])
        writer.writerow(["meta", "model_loaded", payload["meta"]["model_loaded"]])

        for section, stats in payload["telemetry"]["summary"].items():
            for stat, val in stats.items():
                writer.writerow(["telemetry", f"{section}.{stat}", val])

        opt = payload.get("optimization") or {}
        for k, v in opt.items():
            writer.writerow(["optimization", k, v])

        ren = payload.get("renewable") or {}
        for k, stats in ren.items():
            for stat, val in stats.items():
                writer.writerow(["renewable", f"{k}.{stat}", val])

        bat = payload.get("battery") or {}
        for k, stats in bat.items():
            for stat, val in stats.items():
                writer.writerow(["battery", f"{k}.{stat}", val])

        xai = payload.get("explainability") or {}
        writer.writerow(["explainability", "reasoning", xai.get("reasoning", "")])
        writer.writerow(["explainability", "summary", xai.get("summary", "")])

        rl = payload.get("rl_metrics") or {}
        if rl.get("episode_summary"):
            for policy, metrics in rl["episode_summary"].items():
                for mk, mv in metrics.items():
                    writer.writerow(["rl_metrics", f"{policy}.{mk}", mv])

        writer.writerow([])
        writer.writerow(["--- telemetry detail export ---"])
        writer.write(self.telemetry_csv(payload["telemetry"]["rows"]))
        return buf.getvalue()

    # ------------------------------------------------------------------
    # PDF export
    # ------------------------------------------------------------------

    def render_pdf(self, payload: dict[str, Any] | None = None, *, report_type: str = "enterprise") -> bytes:
        payload = payload or self.collect_enterprise_payload()
        try:
            from fpdf import FPDF
        except ImportError as exc:
            raise RuntimeError(
                "PDF export requires fpdf2. Install: pip install fpdf2"
            ) from exc

        pdf = FPDF()
        pdf.set_auto_page_break(auto=True, margin=14)
        pdf.add_page()

        pdf.set_font("Helvetica", "B", 16)
        pdf.cell(0, 10, "V2B Neural Grid — Enterprise Report", ln=True)
        pdf.set_font("Helvetica", "", 10)
        pdf.cell(0, 6, f"Generated: {payload['meta']['generated_at']}", ln=True)
        pdf.cell(0, 6, f"Environment: {payload['meta']['environment']} | Rows: {payload['meta']['row_count']}", ln=True)
        pdf.ln(4)

        if report_type == "telemetry":
            self._pdf_section_telemetry(pdf, payload)
        elif report_type == "decisions":
            self._pdf_section_decisions(pdf, payload)
        elif report_type == "forecast":
            self._pdf_section_forecast(pdf, payload)
        else:
            self._pdf_section_executive_summary(pdf, payload)
            self._pdf_section_telemetry(pdf, payload)
            self._pdf_section_renewable_battery(pdf, payload)
            self._pdf_section_optimization_xai(pdf, payload)
            self._pdf_section_forecast(pdf, payload)
            self._pdf_section_rl_metrics(pdf, payload)
            self._pdf_section_decisions(pdf, payload)

        out = pdf.output()
        return out if isinstance(out, bytes) else out.encode("latin-1")

    def _pdf_heading(self, pdf: Any, text: str) -> None:
        pdf.set_font("Helvetica", "B", 12)
        pdf.set_text_color(0, 120, 140)
        pdf.cell(0, 8, text, ln=True)
        pdf.set_text_color(0, 0, 0)
        pdf.set_font("Helvetica", "", 10)

    def _pdf_kv_table(self, pdf: Any, rows: list[tuple[str, str]]) -> None:
        for label, value in rows:
            pdf.set_font("Helvetica", "B", 9)
            pdf.cell(55, 6, str(label)[:40], border=0)
            pdf.set_font("Helvetica", "", 9)
            pdf.multi_cell(0, 6, str(value)[:500])

    def _pdf_section_executive_summary(self, pdf: Any, payload: dict[str, Any]) -> None:
        self._pdf_heading(pdf, "Executive Summary")
        opt = payload.get("optimization") or {}
        self._pdf_kv_table(
            pdf,
            [
                ("Optimization action", opt.get("optimization_action", "—")),
                ("Risk level", opt.get("risk_level", "—")),
                ("Confidence", f"{_safe_float(opt.get('confidence_score')) * 100:.0f}%"),
                ("Policy source", opt.get("policy_source", "—")),
                ("Model loaded", "Yes" if payload["meta"]["model_loaded"] else "No (fallback)"),
            ],
        )
        pdf.ln(3)

    def _pdf_section_telemetry(self, pdf: Any, payload: dict[str, Any]) -> None:
        self._pdf_heading(pdf, "Telemetry Analytics")
        summary = payload["telemetry"]["summary"]
        rows = []
        for metric, stats in summary.items():
            rows.append(
                (
                    metric,
                    f"latest {stats['latest']} | avg {stats['avg']} | min {stats['min']} | max {stats['max']}",
                )
            )
        self._pdf_kv_table(pdf, rows)

        chart = payload["telemetry"].get("chart_series", {}).get("load") or []
        if chart:
            pdf.ln(2)
            pdf.set_font("Helvetica", "B", 9)
            pdf.cell(0, 6, "Recent load samples (last 8)", ln=True)
            pdf.set_font("Helvetica", "", 8)
            for point in chart[-8:]:
                pdf.cell(
                    0,
                    5,
                    f"  {point.get('time', '')[:19]} — {point.get('load_kw', 0):.1f} kW load, {point.get('charging_kw', 0):.1f} kW charging",
                    ln=True,
                )
        pdf.ln(3)

    def _pdf_section_renewable_battery(self, pdf: Any, payload: dict[str, Any]) -> None:
        self._pdf_heading(pdf, "Renewable & Battery Analytics")
        ren = payload.get("renewable") or {}
        bat = payload.get("battery") or {}
        rows = []
        for label, stats in ren.items():
            rows.append((f"Renewable · {label}", f"latest {stats['latest']} avg {stats['avg']}"))
        for label, stats in bat.items():
            rows.append((f"Battery · {label}", f"latest {stats['latest']} avg {stats['avg']}"))
        self._pdf_kv_table(pdf, rows)
        pdf.ln(3)

    def _pdf_section_optimization_xai(self, pdf: Any, payload: dict[str, Any]) -> None:
        self._pdf_heading(pdf, "Optimization & Explainability")
        opt = payload.get("optimization") or {}
        xai = payload.get("explainability") or {}
        self._pdf_kv_table(
            pdf,
            [
                ("Charging strategy", opt.get("charging_strategy", "—")),
                ("Renewable strategy", opt.get("renewable_strategy", "—")),
                ("Peak shaving", opt.get("peak_shaving_action", "—")),
                ("Grid balancing", opt.get("grid_balancing_action", "—")),
                ("XAI summary", xai.get("summary") or xai.get("reasoning") or "—"),
            ],
        )
        factors = xai.get("factors") or xai.get("top_factors") or []
        if factors:
            pdf.ln(2)
            pdf.set_font("Helvetica", "B", 9)
            pdf.cell(0, 6, "Top explainability factors", ln=True)
            pdf.set_font("Helvetica", "", 8)
            for f in factors[:6]:
                if isinstance(f, dict):
                    pdf.cell(0, 5, f"  • {f.get('label', f.get('name', 'factor'))}: {f.get('impact', f.get('value', ''))}", ln=True)
                else:
                    pdf.cell(0, 5, f"  • {f}", ln=True)
        pdf.ln(3)

    def _pdf_section_forecast(self, pdf: Any, payload: dict[str, Any]) -> None:
        self._pdf_heading(pdf, "Forecast Outlook")
        bundle = payload.get("forecast", {}).get("bundle") or {}
        summary = payload.get("forecast", {}).get("summary") or {}
        self._pdf_kv_table(
            pdf,
            [
                ("Horizon steps", str(bundle.get("horizon", "—"))),
                ("Load trend 1h", str(summary.get("load_trend_1h", "—"))),
                ("Load MA 24", str(summary.get("load_ma_24", "—"))),
                ("Next load forecast", str(summary.get("load_forecast_next", "—"))),
            ],
        )
        load_fc = bundle.get("load_kw") or []
        if load_fc:
            pdf.set_font("Helvetica", "", 8)
            pdf.cell(0, 5, "Projected load (kW): " + ", ".join(f"{v:.1f}" for v in load_fc[:8]), ln=True)
        pdf.ln(3)

    def _pdf_section_rl_metrics(self, pdf: Any, payload: dict[str, Any]) -> None:
        rl = payload.get("rl_metrics") or {}
        if not rl.get("available"):
            return
        self._pdf_heading(pdf, "RL Evaluation Metrics")
        summary = rl.get("episode_summary") or {}
        for policy, metrics in summary.items():
            pdf.set_font("Helvetica", "B", 9)
            pdf.cell(0, 6, f"Policy: {policy}", ln=True)
            pdf.set_font("Helvetica", "", 8)
            for k, v in metrics.items():
                pdf.cell(0, 5, f"  {k}: {v}", ln=True)
        pdf.ln(3)

    def _pdf_section_decisions(self, pdf: Any, payload: dict[str, Any]) -> None:
        self._pdf_heading(pdf, "AI Decision Log")
        decisions = payload.get("decisions") or []
        inference = payload.get("inference") or {}
        if not decisions:
            self._pdf_kv_table(
                pdf,
                [
                    ("Primary action", inference.get("optimization_action", "—")),
                    ("Recommendation", inference.get("ai_recommendation", "—")),
                    ("Reasoning", inference.get("ai_reasoning", "—")[:400]),
                ],
            )
            return
        for i, d in enumerate(decisions[:12]):
            title = d.get("title") or d.get("action") or f"Decision {i + 1}"
            pdf.set_font("Helvetica", "B", 9)
            pdf.cell(0, 6, str(title)[:80], ln=True)
            pdf.set_font("Helvetica", "", 8)
            pdf.multi_cell(0, 5, str(d.get("summary") or d.get("description") or json.dumps(d)[:300]))
            pdf.ln(1)
        pdf.ln(2)

    # ------------------------------------------------------------------
    # Unified export entry
    # ------------------------------------------------------------------

    def export(
        self,
        report_type: Literal["telemetry", "decisions", "forecast", "enterprise"],
        fmt: ExportFormat,
    ) -> tuple[bytes | str, str, str]:
        """
        Returns (content, media_type, filename).
        """
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        payload = None if report_type == "telemetry" and fmt == "csv" else self.collect_enterprise_payload()

        if fmt == "csv":
            if report_type == "telemetry":
                content = self.telemetry_csv()
            elif report_type == "decisions":
                content = self.decisions_csv(payload)
            elif report_type == "forecast":
                content = self.forecast_csv(payload)
            else:
                content = self.enterprise_csv(payload)
            filename = f"v2b_{report_type}_{stamp}.csv"
            return content, "text/csv; charset=utf-8", filename

        content = self.render_pdf(payload, report_type=report_type)
        filename = f"v2b_{report_type}_{stamp}.pdf"
        return content, "application/pdf", filename


report_generator = ReportGenerator()
