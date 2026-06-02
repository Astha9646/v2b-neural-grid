"""
Production CORS configuration for Vercel (frontend) + Render/Railway (API).

With ``allow_credentials=True``, origins cannot be ``*`` — we allow explicit
``FRONTEND_URL`` / ``CORS_ORIGINS`` plus a regex for ``*.vercel.app`` previews.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.config import Settings

logger = logging.getLogger(__name__)


def configure_cors(app: FastAPI, settings: Settings) -> None:
    """Attach CORSMiddleware with production-safe defaults."""
    origins = settings.cors_origins_list
    origin_regex = settings.cors_origin_regex_pattern

    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_origin_regex=origin_regex,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["*"],
        max_age=600,
    )

    logger.info(
        "CORS enabled credentials=True methods=* headers=* origins=%s regex=%s",
        origins,
        origin_regex,
    )
