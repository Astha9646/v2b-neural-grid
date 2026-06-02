"""
Railway deployment entrypoint.

Binds uvicorn to ``0.0.0.0`` on the platform ``PORT`` with proxy/WebSocket settings
required for Railway's edge network.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

logger = logging.getLogger(__name__)


def main() -> None:
    import uvicorn

    from backend.config import configure_logging, get_settings
    from backend.railway_config import log_railway_diagnostics

    settings = get_settings()
    configure_logging(settings)
    log_railway_diagnostics(settings)

    host = "0.0.0.0"
    port = settings.api_port

    logger.info(
        "Railway uvicorn start host=%s port=%s environment=%s ws=%s",
        host,
        port,
        settings.environment,
        settings.resolved_ws_base_url,
    )

    uvicorn.run(
        "backend.main:app",
        host=host,
        port=port,
        proxy_headers=True,
        forwarded_allow_ips="*",
        ws="websockets",
        ws_ping_interval=20.0,
        ws_ping_timeout=float(settings.ws_ping_timeout_sec),
        timeout_keep_alive=75,
        access_log=not settings.is_production,
        log_level=(settings.log_level or "info").lower(),
        workers=1,
    )


if __name__ == "__main__":
    main()
