"""
Enterprise report export API routes.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response

from backend.auth import require_authenticated_user
from backend.models import User
from backend.report_generator import ExportFormat, report_generator

report_router = APIRouter(prefix="/reports", tags=["reports"])

ReportType = Literal["telemetry", "decisions", "forecast", "enterprise"]


def _file_response(content: bytes | str, media_type: str, filename: str) -> Response:
    body = content.encode("utf-8") if isinstance(content, str) else content
    return Response(
        content=body,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@report_router.get("/export/telemetry")
async def export_telemetry(
    format: ExportFormat = Query("csv", alias="format"),
    _user: User = Depends(require_authenticated_user),
) -> Response:
    """Export telemetry history as CSV or PDF summary."""
    try:
        content, media_type, filename = report_generator.export("telemetry", format)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    return _file_response(content, media_type, filename)


@report_router.get("/export/decisions")
async def export_decisions(
    format: ExportFormat = Query("csv", alias="format"),
    _user: User = Depends(require_authenticated_user),
) -> Response:
    """Export AI decision log as CSV or PDF."""
    try:
        content, media_type, filename = report_generator.export("decisions", format)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    return _file_response(content, media_type, filename)


@report_router.get("/export/forecast")
async def export_forecast(
    format: ExportFormat = Query("csv", alias="format"),
    _user: User = Depends(require_authenticated_user),
) -> Response:
    """Export forecast bundle as CSV or PDF."""
    try:
        content, media_type, filename = report_generator.export("forecast", format)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    return _file_response(content, media_type, filename)


@report_router.get("/export/enterprise")
async def export_enterprise(
    format: ExportFormat = Query("pdf", alias="format"),
    _user: User = Depends(require_authenticated_user),
) -> Response:
    """Full enterprise report — telemetry, RL, XAI, renewable, battery, optimization."""
    try:
        content, media_type, filename = report_generator.export("enterprise", format)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    return _file_response(content, media_type, filename)


@report_router.get("/preview")
async def report_preview(
    _user: User = Depends(require_authenticated_user),
) -> dict:
    """JSON preview of enterprise report sections (for Report Center UI)."""
    payload = report_generator.collect_enterprise_payload()
    return {
        "meta": payload["meta"],
        "telemetry_summary": payload["telemetry"]["summary"],
        "chart_series": payload["telemetry"].get("chart_series"),
        "optimization": payload["optimization"],
        "renewable": payload["renewable"],
        "battery": payload["battery"],
        "decision_count": len(payload.get("decisions") or []),
        "forecast_horizon": payload.get("forecast", {}).get("bundle", {}).get("horizon"),
        "rl_available": bool(payload.get("rl_metrics", {}).get("available")),
        "explainability_summary": (payload.get("explainability") or {}).get("summary")
        or (payload.get("explainability") or {}).get("reasoning"),
    }
