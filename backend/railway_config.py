"""
Railway / PaaS deployment helpers — platform env detection and diagnostics.
"""

from __future__ import annotations

import logging
import os
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from backend.config import Settings

logger = logging.getLogger(__name__)


def is_railway() -> bool:
    """True when running on Railway (any service)."""
    return bool(os.getenv("RAILWAY_ENVIRONMENT") or os.getenv("RAILWAY_PUBLIC_DOMAIN"))


def railway_public_domain() -> str | None:
    domain = (os.getenv("RAILWAY_PUBLIC_DOMAIN") or "").strip()
    return domain or None


def apply_railway_settings(settings: Settings) -> Settings:  # noqa: F821 — Settings via TYPE_CHECKING
    """
    Apply Railway platform defaults in-place.

    - ``PORT`` → ``api_port`` (when ``API_PORT`` is unset)
    - ``0.0.0.0`` bind host
    - production log level
    - ``wss://`` WebSocket base from public domain
    """
    port_env = os.getenv("PORT")
    if port_env and not os.getenv("API_PORT"):
        try:
            object.__setattr__(settings, "api_port", int(port_env))
        except ValueError:
            logger.warning("Invalid PORT=%r — keeping api_port=%s", port_env, settings.api_port)

    if not is_railway():
        return settings

    if not os.getenv("ENVIRONMENT") and not os.getenv("APP_ENV"):
        object.__setattr__(settings, "environment", "production")

    if not os.getenv("API_HOST"):
        object.__setattr__(settings, "api_host", "0.0.0.0")

    if not os.getenv("LOG_LEVEL"):
        object.__setattr__(settings, "log_level", "INFO")

    if not os.getenv("DEBUG"):
        object.__setattr__(settings, "debug", False)

    domain = railway_public_domain()
    if domain:
        if not os.getenv("WS_BASE_URL"):
            object.__setattr__(settings, "ws_base_url", f"wss://{domain}")
        # When frontend is on the same Railway project, set FRONTEND_URL in the dashboard.
        # If unset, CORS falls back to FRONTEND_URL default or wildcard in production.

    return settings


def log_railway_diagnostics(settings: Settings) -> None:
    """Emit startup diagnostics for Railway deploy logs."""
    payload: dict[str, Any] = {
        "platform": "railway" if is_railway() else "local",
        "environment": settings.environment,
        "host": settings.api_host,
        "port": settings.api_port,
        "public_domain": railway_public_domain(),
        "api_base_url": settings.api_base_url,
        "ws_base_url": settings.resolved_ws_base_url,
        "ws_paths": {
            "telemetry": settings.ws_telemetry_path,
            "forecast": settings.ws_forecast_path,
            "ai": settings.ws_ai_path,
        },
        "healthcheck": "/healthz",
        "health": "/health",
    }
    logger.info("Deployment diagnostics: %s", payload)


def websocket_deploy_hints(settings: Settings) -> dict[str, str]:
    """WebSocket URLs for client configuration on Railway."""
    base = settings.resolved_ws_base_url.rstrip("/")
    return {
        "telemetry": f"{base}{settings.ws_telemetry_path}",
        "forecast": f"{base}{settings.ws_forecast_path}",
        "ai": f"{base}{settings.ws_ai_path}",
    }
