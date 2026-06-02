"""
V2B Neural Grid — backend configuration (Pydantic BaseSettings).

Loads from ``backend/.env`` plus process environment overrides.
Set ``ENVIRONMENT=production`` and a strong ``JWT_SECRET_KEY`` in production.
"""

from __future__ import annotations

import logging
import os
import secrets
import warnings
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent

DEFAULT_CHECKPOINT_DIR = PROJECT_ROOT / "checkpoints" / "quick_test" / "best"
DEFAULT_EVAL_REPORT = PROJECT_ROOT / "evaluation" / "quick_test_run" / "evaluation_report.json"
DEFAULT_EVAL_METRICS_CSV = PROJECT_ROOT / "evaluation" / "quick_test_run" / "episode_metrics.csv"
DEFAULT_DATASET = PROJECT_ROOT / "data" / "processed_ev_data.csv"
DEFAULT_DATABASE_PATH = PROJECT_ROOT / "data" / "v2b_api.db"
DEFAULT_TELEMETRY_PATH = PROJECT_ROOT / "data" / "grid_telemetry.csv"

DEFAULT_WS_PATHS = {
    "telemetry": "/ws/telemetry",
    "forecast": "/ws/forecast",
    "ai": "/ws/ai",
}


def _dev_jwt_fallback() -> str:
    return os.getenv("V2B_DEV_JWT_SECRET", secrets.token_urlsafe(48))


def _railway_public_domain() -> str | None:
    domain = (os.getenv("RAILWAY_PUBLIC_DOMAIN") or "").strip()
    return domain or None


def _is_railway() -> bool:
    return bool(os.getenv("RAILWAY_ENVIRONMENT") or os.getenv("RAILWAY_PUBLIC_DOMAIN"))


def _resolve_path(value: Path) -> Path:
    return value if value.is_absolute() else PROJECT_ROOT / value


class Settings(BaseSettings):
    """Application settings loaded from ``backend/.env``."""

    model_config = SettingsConfigDict(
        env_file=str(BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
        populate_by_name=True,
    )

    # --- Required environment contract ---
    api_host: str = Field(default="0.0.0.0", validation_alias="API_HOST")
    api_port: int = Field(
        default=8001,
        validation_alias=AliasChoices("API_PORT", "PORT"),
    )
    environment: Literal["development", "staging", "production"] = Field(
        default="development",
        validation_alias=AliasChoices("ENVIRONMENT", "APP_ENV"),
    )
    jwt_secret_key: str = Field(default_factory=_dev_jwt_fallback, validation_alias="JWT_SECRET_KEY")
    frontend_url: str = Field(default="http://localhost:5173", validation_alias="FRONTEND_URL")
    ws_base_url: str = Field(default="", validation_alias="WS_BASE_URL")
    log_level: str = Field(default="INFO", validation_alias="LOG_LEVEL")

    # --- API / CORS ---
    api_title: str = Field(default="V2B Smart Charging API")
    api_version: str = Field(default="1.0.0")
    cors_origins: str = Field(default="")
    debug: bool = Field(default=False)

    # --- WebSocket route paths (suffix under WS mount) ---
    ws_telemetry_path: str = Field(default=DEFAULT_WS_PATHS["telemetry"])
    ws_forecast_path: str = Field(default=DEFAULT_WS_PATHS["forecast"])
    ws_ai_path: str = Field(default=DEFAULT_WS_PATHS["ai"])
    ws_stream_interval_sec: float = Field(default=2.5)
    ws_rows_cache_ttl_sec: float = Field(default=30.0)
    ws_ping_timeout_sec: float = Field(default=45.0)

    # --- RL / inference ---
    checkpoint_dir: Path = Field(default=DEFAULT_CHECKPOINT_DIR)
    device: Literal["auto", "cpu", "cuda"] = Field(
        default="auto",
        validation_alias=AliasChoices("DEVICE", "INFERENCE_DEVICE"),
    )
    num_chargers: int = Field(default=8)
    episode_slots: int = Field(default=24)
    apply_action_mask: bool = Field(default=True)

    # --- Data paths ---
    dataset_path: Path = Field(default=DEFAULT_DATASET)
    telemetry_path: Path = Field(default=DEFAULT_TELEMETRY_PATH)
    eval_report_path: Path = Field(default=DEFAULT_EVAL_REPORT)
    eval_metrics_csv: Path = Field(default=DEFAULT_EVAL_METRICS_CSV)
    telemetry_row_limit: int = Field(default=1000)

    # --- Auth / database ---
    jwt_algorithm: str = Field(default="HS256")
    jwt_access_token_expire_minutes: int = Field(default=60)
    database_url: str = Field(default=f"sqlite:///{DEFAULT_DATABASE_PATH.as_posix()}")
    require_auth: bool = Field(default=True)

    @field_validator(
        "checkpoint_dir",
        "dataset_path",
        "telemetry_path",
        "eval_report_path",
        "eval_metrics_csv",
        mode="before",
    )
    @classmethod
    def _coerce_path(cls, value: str | Path | None) -> Path | None:
        if value is None or value == "":
            return value
        return Path(value)

    @field_validator("require_auth", "apply_action_mask", "debug", mode="before")
    @classmethod
    def _coerce_bool(cls, value: object) -> bool:
        if isinstance(value, bool):
            return value
        if value is None:
            return False
        return str(value).strip().lower() in ("1", "true", "yes", "on")

    @field_validator("ws_base_url", "frontend_url", "cors_origins", mode="before")
    @classmethod
    def _strip_url(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value

    @model_validator(mode="after")
    def _apply_environment_defaults(self) -> Settings:
        if self.environment == "development":
            if not os.getenv("DEBUG"):
                object.__setattr__(self, "debug", True)
            if not os.getenv("LOG_LEVEL"):
                object.__setattr__(self, "log_level", "DEBUG")
        if self.environment == "production" and not os.getenv("JWT_SECRET_KEY"):
            warnings.warn(
                "JWT_SECRET_KEY is not set while ENVIRONMENT=production — using ephemeral secret. "
                "Set JWT_SECRET_KEY before deployment.",
                stacklevel=2,
            )
        from backend.railway_config import apply_railway_settings

        return apply_railway_settings(self)

    # --- Backward-compatible aliases ---
    @property
    def host(self) -> str:
        return self.api_host

    @property
    def port(self) -> int:
        return self.api_port

    @property
    def app_env(self) -> str:
        return self.environment

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def is_development(self) -> bool:
        return self.environment == "development"

    @property
    def expose_error_details(self) -> bool:
        return self.debug or self.is_development

    @property
    def public_hostname(self) -> str:
        """Hostname clients should use (Railway public domain when deployed)."""
        domain = _railway_public_domain()
        if domain:
            return domain
        if self.api_host not in ("0.0.0.0", "::"):
            return self.api_host
        return "127.0.0.1"

    @property
    def bind_host(self) -> str:
        """Host clients should use when api_host is 0.0.0.0."""
        return self.public_hostname

    @property
    def is_railway(self) -> bool:
        return _is_railway()

    @property
    def api_base_url(self) -> str:
        domain = _railway_public_domain()
        if domain:
            return f"https://{domain}"
        return f"http://{self.public_hostname}:{self.api_port}"

    @property
    def resolved_ws_base_url(self) -> str:
        if self.ws_base_url:
            return self.ws_base_url.rstrip("/")
        domain = _railway_public_domain()
        if domain:
            return f"wss://{domain}"
        return f"ws://{self.public_hostname}:{self.api_port}"

    @property
    def cors_origins_list(self) -> list[str]:
        raw = (self.cors_origins or "").strip()
        if raw and raw != "*":
            return [origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()]

        origins: list[str] = []
        if self.frontend_url:
            origins.append(self.frontend_url.rstrip("/"))
        if self.is_development:
            for url in ("http://127.0.0.1:5173", "http://localhost:3000"):
                cleaned = url.rstrip("/")
                if cleaned not in origins:
                    origins.append(cleaned)
        return origins if origins else ["*"]

    @property
    def telemetry_file(self) -> Path:
        return _resolve_path(self.telemetry_path)

    @property
    def legacy_dataset_file(self) -> Path:
        return _resolve_path(self.dataset_path)

    @property
    def checkpoint_dir_resolved(self) -> Path:
        return _resolve_path(self.checkpoint_dir)


@lru_cache
def get_settings() -> Settings:
    return Settings()


def configure_logging(cfg: Settings | None = None) -> None:
    """Environment-aware logging bootstrap."""
    from backend.railway_config import is_railway

    settings = cfg or get_settings()
    level_name = (settings.log_level or "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    log_format = (
        "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"
        if settings.is_development
        else "%(asctime)s | %(levelname)s | %(name)s | %(message)s"
    )
    logging.basicConfig(
        level=level,
        format=log_format,
        force=True,
    )
    if settings.is_production or _is_railway():
        logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
        logging.getLogger("uvicorn.error").setLevel(logging.INFO)
    logging.getLogger(__name__).info(
        "Settings loaded environment=%s api=%s:%s frontend=%s ws=%s railway=%s",
        settings.environment,
        settings.api_host,
        settings.api_port,
        settings.frontend_url,
        settings.resolved_ws_base_url,
        is_railway(),
    )


settings: Settings = get_settings()

# Legacy alias
AppSettings = Settings
