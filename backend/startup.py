"""
Production startup validation, health tracking, and graceful bootstrap.

Validates optional resources at boot (RL checkpoints, telemetry CSV, WebSocket
manager, forecasting engine) without preventing the API from serving traffic.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

from backend.config import PROJECT_ROOT, Settings, settings
from backend.forecasting import forecasting_engine
from backend.inference import model_service
from backend.telemetry_loader import load_telemetry_rows, resolve_dataset_path
from backend.websocket_manager import grid_stream_manager

logger = logging.getLogger(__name__)

DDPG_ACTOR_FLAT = PROJECT_ROOT / "checkpoints" / "ddpg_actor.pth"


class ComponentState(str, Enum):
    OK = "ok"
    DEGRADED = "degraded"
    UNAVAILABLE = "unavailable"
    ERROR = "error"


@dataclass
class ComponentHealth:
    name: str
    state: ComponentState
    message: str = ""
    path: str | None = None
    fallback_active: bool = False
    details: dict[str, Any] = field(default_factory=dict)


@dataclass
class StartupReport:
    """Aggregated startup diagnostics exposed via /health."""

    started_at: float = field(default_factory=time.time)
    environment: str = "development"
    components: dict[str, ComponentHealth] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    @property
    def overall_status(self) -> str:
        states = {c.state for c in self.components.values()}
        if ComponentState.ERROR in states:
            return "error"
        if ComponentState.UNAVAILABLE in states or ComponentState.DEGRADED in states:
            return "degraded"
        return "ok"

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.overall_status,
            "environment": self.environment,
            "uptime_seconds": round(time.time() - self.started_at, 1),
            "warnings": list(self.warnings),
            "errors": list(self.errors),
            "components": {
                name: {
                    "state": comp.state.value,
                    "message": comp.message,
                    "path": comp.path,
                    "fallback_active": comp.fallback_active,
                    "details": comp.details,
                }
                for name, comp in self.components.items()
            },
        }


class StartupHealth:
    """Process-wide startup and runtime health tracker."""

    def __init__(self) -> None:
        self.report = StartupReport()
        self._bootstrapped = False

    def record_warning(self, message: str) -> None:
        if message not in self.report.warnings:
            self.report.warnings.append(message)
        logger.warning(message)

    def record_error(self, message: str) -> None:
        if message not in self.report.errors:
            self.report.errors.append(message)
        logger.error(message)

    def set_component(self, health: ComponentHealth) -> None:
        self.report.components[health.name] = health
        if health.state == ComponentState.OK:
            logger.info(
                "Startup check OK: %s — %s",
                health.name,
                health.message or "ready",
            )
        elif health.state == ComponentState.DEGRADED:
            self.record_warning(f"{health.name}: {health.message}")
        else:
            self.record_error(f"{health.name}: {health.message}")

    def component(self, name: str) -> ComponentHealth | None:
        return self.report.components.get(name)


startup_health = StartupHealth()


def _resolve_checkpoint_paths(cfg: Settings) -> tuple[Path, Path]:
    """Return (inference actor.pt dir, flat ddpg_actor.pth)."""
    ckpt_dir = cfg.checkpoint_dir_resolved
    actor_pt = ckpt_dir / "actor.pt"
    flat_actor = DDPG_ACTOR_FLAT
    return actor_pt, flat_actor


def validate_rl_checkpoint(cfg: Settings | None = None) -> ComponentHealth:
    """Validate RL checkpoint files; inference may still use fallback."""
    cfg = cfg or settings
    actor_pt, flat_actor = _resolve_checkpoint_paths(cfg)

    inference_ok = actor_pt.is_file()
    telemetry_ok = flat_actor.is_file()

    details = {
        "inference_actor_pt": str(actor_pt),
        "telemetry_ddpg_actor": str(flat_actor),
        "inference_present": inference_ok,
        "telemetry_actor_present": telemetry_ok,
    }

    if inference_ok and telemetry_ok:
        return ComponentHealth(
            name="rl_checkpoint",
            state=ComponentState.OK,
            message="Inference and telemetry actor checkpoints found",
            path=str(actor_pt),
            details=details,
        )

    if inference_ok or telemetry_ok:
        missing = []
        if not inference_ok:
            missing.append(f"inference actor.pt ({actor_pt})")
        if not telemetry_ok:
            missing.append(f"telemetry ddpg_actor.pth ({flat_actor})")
        return ComponentHealth(
            name="rl_checkpoint",
            state=ComponentState.DEGRADED,
            message=f"Partial checkpoint availability — missing: {', '.join(missing)}",
            path=str(actor_pt if inference_ok else flat_actor),
            fallback_active=not inference_ok,
            details=details,
        )

    return ComponentHealth(
        name="rl_checkpoint",
        state=ComponentState.UNAVAILABLE,
        message=(
            f"No RL checkpoints found. Expected {actor_pt} or {flat_actor}. "
            "Inference will use heuristic fallback."
        ),
        path=str(flat_actor),
        fallback_active=True,
        details=details,
    )


def validate_telemetry_csv(cfg: Settings | None = None) -> ComponentHealth:
    """Validate grid telemetry CSV (primary or legacy fallback)."""
    cfg = cfg or settings
    path, telemetry_path, legacy_path = resolve_dataset_path(cfg)
    details = {
        "primary": str(telemetry_path),
        "legacy": str(legacy_path),
        "active": str(path),
    }

    if path.is_file():
        try:
            rows = load_telemetry_rows(cfg, limit=1)
            row_hint = len(rows)
        except Exception as exc:
            return ComponentHealth(
                name="telemetry_csv",
                state=ComponentState.ERROR,
                message=f"Telemetry CSV unreadable: {exc}",
                path=str(path),
                details=details,
            )
        return ComponentHealth(
            name="telemetry_csv",
            state=ComponentState.OK,
            message=f"Telemetry CSV ready ({path.name}, sample_rows={row_hint})",
            path=str(path),
            details=details,
        )

    return ComponentHealth(
        name="telemetry_csv",
        state=ComponentState.UNAVAILABLE,
        message=(
            f"Telemetry CSV missing at {telemetry_path}. "
            "Run: python data/preprocess.py --mode telemetry"
        ),
        path=str(telemetry_path),
        fallback_active=True,
        details=details,
    )


def validate_forecasting_engine(cfg: Settings | None = None) -> ComponentHealth:
    """Warm-up forecasting engine; empty-data fallback must not raise."""
    _ = cfg
    try:
        rows = load_telemetry_rows(limit=48)
        ok = forecasting_engine.startup_validate(rows if rows else None)
        if ok:
            return ComponentHealth(
                name="forecasting",
                state=ComponentState.OK,
                message="Forecasting engine warm-up succeeded",
                details={"fallback_available": True},
            )
        return ComponentHealth(
            name="forecasting",
            state=ComponentState.DEGRADED,
            message="Forecasting engine running in empty-data fallback mode",
            fallback_active=True,
            details={"fallback_available": True},
        )
    except Exception as exc:
        logger.exception("Forecasting startup validation failed")
        return ComponentHealth(
            name="forecasting",
            state=ComponentState.ERROR,
            message=f"Forecasting engine failed: {exc}",
            fallback_active=True,
            details={"fallback_available": True, "error": str(exc)},
        )


async def bootstrap_websocket_manager() -> ComponentHealth:
    """Start WebSocket broadcast loop with graceful failure handling."""
    try:
        started = await grid_stream_manager.start_safe()
        if started:
            return ComponentHealth(
                name="websocket_manager",
                state=ComponentState.OK,
                message="WebSocket stream manager running",
                details={
                    "interval_sec": settings.ws_stream_interval_sec,
                    "ws_base_url": settings.resolved_ws_base_url,
                    "paths": {
                        "telemetry": settings.ws_telemetry_path,
                        "forecast": settings.ws_forecast_path,
                        "ai": settings.ws_ai_path,
                    },
                },
            )
        return ComponentHealth(
            name="websocket_manager",
            state=ComponentState.DEGRADED,
            message="WebSocket manager disabled after startup failure",
            fallback_active=True,
            details={"connections_accepted": False},
        )
    except Exception as exc:
        logger.exception("WebSocket manager startup failed")
        return ComponentHealth(
            name="websocket_manager",
            state=ComponentState.ERROR,
            message=f"WebSocket startup failed: {exc}",
            fallback_active=True,
            details={"error": str(exc)},
        )


async def load_inference_model(cfg: Settings | None = None) -> ComponentHealth:
    """Load DDPG inference model; never raises — records fallback state."""
    cfg = cfg or settings
    ckpt_health = validate_rl_checkpoint(cfg)
    startup_health.set_component(ckpt_health)

    if not (cfg.checkpoint_dir_resolved / "actor.pt").is_file():
        model_service.mark_fallback("RL checkpoint missing — heuristic inference active")
        return ComponentHealth(
            name="inference",
            state=ComponentState.DEGRADED,
            message="DDPG inference unavailable; heuristic fallback active",
            path=str(cfg.checkpoint_dir_resolved / "actor.pt"),
            fallback_active=True,
            details={"model_loaded": False, "mode": "heuristic"},
        )

    try:
        await asyncio.to_thread(model_service.load, cfg)
        logger.info("V2B inference model ready")
        return ComponentHealth(
            name="inference",
            state=ComponentState.OK,
            message="DDPG inference model loaded",
            path=str(model_service.checkpoint_dir),
            details={"model_loaded": True, "device": model_service.device},
        )
    except FileNotFoundError as exc:
        model_service.mark_fallback(str(exc))
        startup_health.record_warning(f"Inference load skipped: {exc}")
        return ComponentHealth(
            name="inference",
            state=ComponentState.DEGRADED,
            message=f"Inference fallback active: {exc}",
            fallback_active=True,
            details={"model_loaded": False, "mode": "heuristic"},
        )
    except Exception as exc:
        logger.exception("Inference model load failed")
        model_service.mark_fallback(str(exc))
        startup_health.record_error(f"Inference load error: {exc}")
        return ComponentHealth(
            name="inference",
            state=ComponentState.ERROR,
            message=f"Inference error — fallback active: {exc}",
            fallback_active=True,
            details={"model_loaded": False, "mode": "heuristic", "error": str(exc)},
        )


async def run_startup_validation(cfg: Settings | None = None) -> StartupReport:
    """
    Run all startup checks and optional service bootstrap.

    Never raises — the API must remain available even when optional resources
    are missing.
    """
    cfg = cfg or settings
    tracker = startup_health
    tracker.report.environment = cfg.environment
    tracker.report.started_at = time.time()

    logger.info(
        "Starting V2B backend bootstrap environment=%s api=%s:%s",
        cfg.environment,
        cfg.api_host,
        cfg.api_port,
    )

    tracker.set_component(validate_telemetry_csv(cfg))
    tracker.set_component(await load_inference_model(cfg))
    tracker.set_component(validate_forecasting_engine(cfg))
    tracker.set_component(await bootstrap_websocket_manager())

    tracker._bootstrapped = True
    logger.info(
        "Startup bootstrap complete status=%s warnings=%d errors=%d",
        tracker.report.overall_status,
        len(tracker.report.warnings),
        len(tracker.report.errors),
    )
    if tracker.report.warnings:
        for w in tracker.report.warnings:
            logger.warning("Startup warning: %s", w)
    if tracker.report.errors:
        for e in tracker.report.errors:
            logger.error("Startup error: %s", e)

    return tracker.report


async def shutdown_services() -> None:
    """Graceful async cleanup on application shutdown."""
    logger.info("Shutting down backend services")
    try:
        await grid_stream_manager.stop()
    except Exception as exc:
        logger.warning("WebSocket shutdown error: %s", exc)
    try:
        await asyncio.to_thread(model_service.shutdown)
    except Exception as exc:
        logger.warning("Inference shutdown error: %s", exc)
    logger.info("Backend shutdown complete")
