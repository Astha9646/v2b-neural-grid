"""
System observability API routes for V2B Neural Grid.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from backend.inference import model_service
from backend.schemas import (
    SystemHealthResponse,
    SystemMetricsResponse,
    SystemPerformanceResponse,
    utc_now,
)
from backend.system_monitor import system_monitor
from backend.websocket_manager import StreamChannel, grid_stream_manager

system_router = APIRouter(prefix="/system", tags=["observability"])


async def _ws_context() -> dict[str, Any]:
    """Gather WebSocket pool stats from the stream manager."""
    pool = grid_stream_manager.pool
    by_channel: dict[str, int] = {}
    for ch in StreamChannel:
        by_channel[ch.value] = await pool.count(ch)
    total = sum(by_channel.values())
    active = sum(1 for n in by_channel.values() if n > 0)
    return {
        "websocket_clients": total,
        "websocket_by_channel": by_channel,
        "active_streams": active,
        "model_loaded": model_service.is_loaded,
        "stream_manager_running": grid_stream_manager.is_running,
        "stream_manager_enabled": grid_stream_manager.is_enabled,
    }


@system_router.get("/health", response_model=SystemHealthResponse)
async def system_health() -> SystemHealthResponse:
    """Lightweight health probe with core observability KPIs."""
    ctx = await _ws_context()
    data = await system_monitor.health_snapshot(**ctx)
    return SystemHealthResponse(**data, checked_at=utc_now())


@system_router.get("/metrics", response_model=SystemMetricsResponse)
async def system_metrics() -> SystemMetricsResponse:
    """Full host + stream metrics snapshot."""
    ctx = await _ws_context()
    data = await system_monitor.metrics_snapshot(**ctx)
    return SystemMetricsResponse(**data, checked_at=utc_now())


@system_router.get("/performance", response_model=SystemPerformanceResponse)
async def system_performance() -> SystemPerformanceResponse:
    """Latency percentiles and throughput for ops dashboards."""
    ctx = await _ws_context()
    data = await system_monitor.performance_snapshot(**ctx)
    return SystemPerformanceResponse(**data, checked_at=utc_now())
