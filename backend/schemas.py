"""
Pydantic v2 request/response models for the V2B DDPG smart charging API.

Used by ``backend.main``, ``backend.inference``, and ``backend.auth``.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    SecretStr,
    field_validator,
    model_validator,
)

from rl_env.state_builder import STATE_DIM, STATE_FEATURE_NAMES

# ---------------------------------------------------------------------------
# Shared constants & helpers
# ---------------------------------------------------------------------------

ACTION_TANH_MIN = -1.0
ACTION_TANH_MAX = 1.0
MIN_PASSWORD_LENGTH = 8
DEFAULT_MODEL_VERSION = "1.0.0"


def utc_now() -> datetime:
    """Timezone-aware UTC timestamp for API responses."""
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# 1) Health
# ---------------------------------------------------------------------------


class HealthResponse(BaseModel):
    """Service and model readiness probe (``GET /health``)."""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "status": "ok",
                "model_loaded": True,
                "timestamp": "2026-05-22T12:00:00+00:00",
                "device": "cpu",
                "state_dim": 23,
                "action_dim": 8,
                "checkpoint": "checkpoints/quick_test/best",
            }
        }
    )

    status: Literal["ok", "degraded", "error"] = Field(
        description="Overall API health: ok when model is loaded and ready.",
    )
    model_loaded: bool = Field(description="Whether the DDPG Actor checkpoint is loaded.")
    timestamp: datetime = Field(
        default_factory=utc_now,
        description="UTC time of this health check.",
    )
    # Extended ops fields (optional for dashboards)
    device: str | None = Field(default=None, description="Inference device (cpu/cuda).")
    state_dim: int | None = Field(default=None, description="RL state vector dimension.")
    action_dim: int | None = Field(
        default=None,
        description="Number of heterogeneous EV chargers (action dimension).",
    )
    checkpoint: str | None = Field(default=None, description="Loaded checkpoint directory.")
    startup: dict[str, Any] | None = Field(
        default=None,
        description="Component-level startup diagnostics from bootstrap.",
    )
    inference_fallback: bool = Field(
        default=False,
        description="True when /predict is serving heuristic fallback actions.",
    )


# ---------------------------------------------------------------------------
# System observability
# ---------------------------------------------------------------------------


class LatencyStats(BaseModel):
    """Rolling latency statistics (milliseconds)."""

    avg_ms: float = 0.0
    p50_ms: float = 0.0
    p95_ms: float = 0.0
    p99_ms: float = 0.0


class ThroughputStats(BaseModel):
    """Request and stream throughput."""

    requests_per_second: float = 0.0
    stream_rate: float = 0.0
    telemetry_throughput: float = 0.0


class SystemHealthResponse(BaseModel):
    """Core observability KPIs (``GET /system/health``)."""

    status: Literal["operational", "degraded", "critical"] = "operational"
    cpu_percent: float = 0.0
    ram_percent: float = 0.0
    gpu_percent: float = 0.0
    websocket_clients: int = 0
    api_latency_ms: float = 0.0
    inference_latency_ms: float = 0.0
    forecast_latency_ms: float = 0.0
    uptime: str = "0m 0s"
    uptime_seconds: float = 0.0
    stream_rate: float = 0.0
    requests_per_second: float = 0.0
    model_loaded: bool = False
    stream_manager_running: bool = False
    timestamp: float = 0.0
    checked_at: datetime = Field(default_factory=utc_now)


class SystemMetricsResponse(BaseModel):
    """Full host + stream metrics (``GET /system/metrics``)."""

    status: Literal["operational", "degraded", "critical"] = "operational"
    cpu_percent: float = 0.0
    ram_percent: float = 0.0
    disk_percent: float = 0.0
    gpu_percent: float = 0.0
    gpu_available: bool = False
    gpu_name: str | None = None
    gpu_memory_percent: float = 0.0
    websocket_clients: int = 0
    websocket_by_channel: dict[str, int] = Field(default_factory=dict)
    api_latency_ms: float = 0.0
    api_latency_p95_ms: float = 0.0
    inference_latency_ms: float = 0.0
    inference_latency_p95_ms: float = 0.0
    forecast_latency_ms: float = 0.0
    forecast_latency_p95_ms: float = 0.0
    uptime: str = "0m 0s"
    uptime_seconds: float = 0.0
    stream_rate: float = 0.0
    telemetry_throughput: float = 0.0
    requests_per_second: float = 0.0
    active_streams: int = 0
    stream_manager_running: bool = False
    stream_manager_enabled: bool = True
    model_loaded: bool = False
    timestamp: float = 0.0
    checked_at: datetime = Field(default_factory=utc_now)


class SystemPerformanceResponse(SystemMetricsResponse):
    """Latency percentiles + throughput (``GET /system/performance``)."""

    api: LatencyStats = Field(default_factory=LatencyStats)
    inference: LatencyStats = Field(default_factory=LatencyStats)
    forecast: LatencyStats = Field(default_factory=LatencyStats)
    throughput: ThroughputStats = Field(default_factory=ThroughputStats)


# ---------------------------------------------------------------------------
# 2) Predict — request / response
# ---------------------------------------------------------------------------


class PredictMetadata(BaseModel):
    """
    Optional inference controls and alternate state encodings.

    Use when the client sends named features, session indices, or mask context
  instead of a raw state vector.
    """

    model_config = ConfigDict(extra="forbid")

    state_features: dict[str, float] | None = Field(
        default=None,
        description=f"Named features matching StateBuilder ({STATE_DIM} features).",
    )
    session_index: int | None = Field(
        default=None,
        ge=0,
        description="Row index in processed_ev_data.csv for StateBuilder.build_state().",
    )
    elapsed_hours: float = Field(
        default=0.0,
        ge=0.0,
        description="Hours since plug-in when using session_index.",
    )
    explore: bool = Field(
        default=False,
        description="If True, request exploration noise (ignored in production inference).",
    )
    return_power_kw: bool = Field(
        default=True,
        description="Include physical kW per heterogeneous charger.",
    )
    mask_context: dict[str, Any] | None = Field(
        default=None,
        description="V2BMaskContext fields for safe action masking.",
    )
    charger_ids: list[str] | None = Field(
        default=None,
        description="Optional client-side charger identifiers (metadata only).",
    )
    request_id: str | None = Field(
        default=None,
        max_length=128,
        description="Client correlation id for logging.",
    )


class PredictRequest(BaseModel):
    """
    Smart-grid state for one decision step T_j (``POST /predict``).

    Provide ``state`` (normalized RL vector) and/or ``metadata`` with
    ``state_features`` / ``session_index``.
    """

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "state": [0.5] * STATE_DIM,
                "metadata": {
                    "return_power_kw": True,
                    "mask_context": {
                        "tau_remaining_slots": [3.0, 2.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
                        "c_max": [7.2, 7.2, 50.0, 7.2, 7.2, 7.2, 7.2, 7.2],
                        "c_min": [0.0, 0.0, -50.0, 0.0, 0.0, 0.0, 0.0, 0.0],
                    },
                },
            }
        }
    )

    state: list[float] | None = Field(
        default=None,
        min_length=1,
        description=f"Normalized RL state vector (length {STATE_DIM}, values in [0, 1]).",
    )
    metadata: PredictMetadata | None = Field(
        default=None,
        description="Optional inference options and alternate state encodings.",
    )

    @field_validator("state")
    @classmethod
    def validate_state_values(cls, v: list[float] | None) -> list[float] | None:
        if v is None:
            return v
        cleaned: list[float] = []
        for i, x in enumerate(v):
            if not isinstance(x, (int, float)):
                raise TypeError(f"state[{i}] must be numeric, got {type(x).__name__}")
            xf = float(x)
            if not math.isfinite(xf):
                raise ValueError(f"state[{i}] must be finite (no NaN/Inf)")
            cleaned.append(xf)
        return cleaned

    @model_validator(mode="after")
    def validate_state_source(self) -> PredictRequest:
        meta = self.metadata
        has_state = self.state is not None and len(self.state) > 0
        has_features = meta is not None and meta.state_features is not None
        has_session = meta is not None and meta.session_index is not None

        if not (has_state or has_features or has_session):
            raise ValueError(
                "Provide non-empty 'state' or metadata.state_features or metadata.session_index"
            )

        if has_state and len(self.state) != STATE_DIM:  # type: ignore[arg-type]
            raise ValueError(f"state must have length {STATE_DIM}, got {len(self.state)}")

        if has_features:
            unknown = set(meta.state_features) - set(STATE_FEATURE_NAMES)  # type: ignore[union-attr]
            if unknown:
                raise ValueError(f"Unknown state_features keys: {sorted(unknown)}")

        return self

    def resolved_state_features(self) -> dict[str, float] | None:
        if self.metadata and self.metadata.state_features:
            return self.metadata.state_features
        return None

    def resolved_session_index(self) -> int | None:
        if self.metadata and self.metadata.session_index is not None:
            return self.metadata.session_index
        return None

    def resolved_elapsed_hours(self) -> float:
        if self.metadata:
            return self.metadata.elapsed_hours
        return 0.0

    def resolved_mask_context(self) -> dict[str, Any] | None:
        if self.metadata:
            return self.metadata.mask_context
        return None

    def resolved_explore(self) -> bool:
        if self.metadata:
            return self.metadata.explore
        return False

    def resolved_return_power_kw(self) -> bool:
        if self.metadata:
            return self.metadata.return_power_kw
        return True


class PredictResponse(BaseModel):
    """DDPG charging/discharging actions for heterogeneous EV chargers."""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "actions": [0.42, -0.15, 0.0, 0.88, 0.1, -0.3, 0.0, 0.55],
                "actions_kw": [5.1, -2.0, 0.0, 6.8, 3.2, -4.0, 0.0, 4.5],
                "inference_time_ms": 12.4,
                "model_version": "1.0.0",
                "timestamp": "2026-05-22T12:00:01+00:00",
                "action_dim": 8,
            }
        }
    )

    actions: list[float] = Field(
        description="Safe continuous actions per charger (tanh in [-1, 1]; + charge, − V2B).",
    )
    inference_time_ms: float = Field(
        ge=0.0,
        description="Wall-clock inference latency in milliseconds.",
    )
    model_version: str = Field(
        default=DEFAULT_MODEL_VERSION,
        description="API / checkpoint version string.",
    )
    timestamp: datetime = Field(
        default_factory=utc_now,
        description="UTC time when inference completed.",
    )
    actions_kw: list[float] | None = Field(
        default=None,
        description="Physical power [kW] per heterogeneous charger after masking.",
    )
    action_dim: int | None = Field(
        default=None,
        description="Number of chargers (length of actions).",
    )
    fallback: bool = Field(
        default=False,
        description="True when heuristic fallback was used instead of DDPG.",
    )
    policy_source: str | None = Field(
        default=None,
        description="ddpg or heuristic_fallback.",
    )

    @field_validator("actions")
    @classmethod
    def validate_bounded_actions(cls, v: list[float]) -> list[float]:
        if not v:
            raise ValueError("actions must be non-empty")
        out: list[float] = []
        for i, x in enumerate(v):
            if not isinstance(x, (int, float)) or not math.isfinite(float(x)):
                raise ValueError(f"actions[{i}] must be a finite number")
            xf = float(x)
            if xf < ACTION_TANH_MIN - 1e-3 or xf > ACTION_TANH_MAX + 1e-3:
                raise ValueError(
                    f"actions[{i}]={xf} out of bounds [{ACTION_TANH_MIN}, {ACTION_TANH_MAX}]"
                )
            out.append(max(ACTION_TANH_MIN, min(ACTION_TANH_MAX, xf)))
        return out

    @field_validator("actions_kw")
    @classmethod
    def validate_actions_kw(cls, v: list[float] | None) -> list[float] | None:
        if v is None:
            return v
        for i, x in enumerate(v):
            if not math.isfinite(float(x)):
                raise ValueError(f"actions_kw[{i}] must be finite")
        return v

    @model_validator(mode="after")
    def align_action_lengths(self) -> PredictResponse:
        if self.action_dim is None:
            object.__setattr__(self, "action_dim", len(self.actions))
        if self.actions_kw is not None and len(self.actions_kw) != len(self.actions):
            raise ValueError(
                f"actions_kw length {len(self.actions_kw)} != actions length {len(self.actions)}"
            )
        return self


# ---------------------------------------------------------------------------
# 3) Metrics
# ---------------------------------------------------------------------------


class MetricsResponse(BaseModel):
    """Aggregated V2B evaluation KPIs (``GET /metrics``)."""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "available": True,
                "average_reward": 142.5,
                "peak_demand": 118.3,
                "electricity_cost": 45.2,
                "renewable_utilization": 0.62,
                "charging_satisfaction": 0.91,
                "battery_degradation": 0.03,
                "policy": "ddpg",
                "n_episodes": 20,
            }
        }
    )

    average_reward: float | None = Field(
        default=None,
        description="Mean episode reward (higher is better).",
    )
    peak_demand: float | None = Field(
        default=None,
        description="Mean peak demand [kW] (lower is better).",
    )
    electricity_cost: float | None = Field(
        default=None,
        description="Mean electricity cost [USD] (lower is better).",
    )
    renewable_utilization: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Fraction of renewable energy utilized.",
    )
    charging_satisfaction: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Fraction of target SOC achieved at departure.",
    )
    battery_degradation: float | None = Field(
        default=None,
        ge=0.0,
        description="Mean battery degradation proxy.",
    )
    available: bool = Field(
        default=False,
        description="Whether evaluation artifacts were found on disk.",
    )
    policy: str | None = Field(default="ddpg", description="Policy label for metrics row.")
    n_episodes: int | None = Field(default=None, ge=0, description="Episodes aggregated.")
    message: str | None = Field(
        default=None,
        description="Hint when metrics are unavailable (run evaluate.py).",
    )
    # Raw artifacts for advanced clients
    report: dict[str, Any] | None = Field(default=None, exclude=True)
    episode_summary: dict[str, Any] | None = Field(default=None, exclude=True)

    @classmethod
    def from_engine_metrics(cls, data: dict[str, Any]) -> MetricsResponse:
        """Build response from ``InferenceEngine.get_metrics()`` payload."""
        if not data.get("available"):
            return cls(
                available=False,
                message=data.get(
                    "message",
                    "No evaluation files found. Run: python evaluate.py",
                ),
            )

        summary = data.get("episode_summary") or {}
        ddpg = summary.get("ddpg") or next(iter(summary.values()), {})

        return cls(
            available=True,
            average_reward=_optional_float(ddpg.get("mean_reward")),
            peak_demand=_optional_float(ddpg.get("mean_peak_kw")),
            electricity_cost=_optional_float(ddpg.get("mean_cost_usd")),
            renewable_utilization=_optional_float(ddpg.get("mean_renewable_util")),
            charging_satisfaction=_optional_float(ddpg.get("mean_charging_satisfaction")),
            battery_degradation=_optional_float(ddpg.get("mean_battery_degradation")),
            policy="ddpg" if "ddpg" in summary else None,
            n_episodes=_optional_int(ddpg.get("n_episodes")),
            report=data.get("report"),
            episode_summary=summary,
        )


def _optional_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def _optional_int(v: Any) -> int | None:
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# 4) Evaluate
# ---------------------------------------------------------------------------


class EvaluateRequest(BaseModel):
    """On-demand evaluation run (``POST /evaluate``)."""

    num_episodes: int = Field(default=5, ge=1, le=100)
    run_baseline: bool = True
    num_chargers: int | None = Field(default=None, ge=1, le=64)
    episode_slots: int | None = Field(default=None, ge=1, le=96)
    checkpoint_dir: str | None = None
    output_dir: str | None = None
    seed: int = Field(default=123, ge=0)


class EvaluateResponse(BaseModel):
    """Results from a completed evaluation run."""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "episode_reward": 150.2,
                "total_cost": 42.5,
                "peak_reduction": 12.3,
                "renewable_usage": 0.65,
                "evaluation_summary": {"num_episodes": 5, "status": "completed"},
                "status": "completed",
                "output_dir": "evaluation/api_run",
            }
        }
    )

    episode_reward: float = Field(description="Mean DDPG episode reward over the run.")
    total_cost: float = Field(description="Mean electricity cost [USD] (DDPG policy).")
    peak_reduction: float = Field(
        description="Peak demand reduction vs random baseline [%], if baseline ran.",
    )
    renewable_usage: float = Field(
        ge=0.0,
        le=1.0,
        description="Mean renewable utilization (DDPG policy).",
    )
    evaluation_summary: dict[str, Any] = Field(
        description="Full evaluation report excerpt (policies, paths, reductions).",
    )
    status: str = Field(default="completed")
    output_dir: str | None = None
    num_episodes: int | None = None
    message: str | None = None

    @classmethod
    def from_evaluation_report(
        cls,
        report: dict[str, Any],
        *,
        output_dir: str,
        num_episodes: int,
        message: str | None = None,
    ) -> EvaluateResponse:
        """Map ``evaluate.run_evaluation`` JSON report to API response."""
        summary = report.get("summary") or {}
        ddpg = summary.get("ddpg") or {}
        reductions = report.get("reductions_vs_random") or {}

        def _mean(key: str) -> float:
            return float(ddpg.get(f"{key}_mean", ddpg.get(key, 0.0)))

        return cls(
            episode_reward=_mean("episode_reward"),
            total_cost=_mean("electricity_cost_usd"),
            peak_reduction=float(reductions.get("peak_demand_reduction_pct", 0.0)),
            renewable_usage=_mean("renewable_utilization"),
            evaluation_summary={
                "checkpoint": report.get("checkpoint"),
                "reductions_vs_random": reductions,
                "summary": summary,
                "num_episodes": num_episodes,
            },
            status="completed",
            output_dir=output_dir,
            num_episodes=num_episodes,
            message=message,
        )


# ---------------------------------------------------------------------------
# 5–8) Authentication
# ---------------------------------------------------------------------------


class UserCreate(BaseModel):
    """Register a new dashboard / API user."""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "username": "grid_operator",
                "email": "operator@example.com",
                "password": "secure-password-1",
            }
        }
    )

    username: str = Field(
        min_length=3,
        max_length=64,
        pattern=r"^[a-zA-Z0-9_\-]+$",
        description="Unique alphanumeric username.",
    )
    email: EmailStr = Field(description="Valid email address.")
    password: SecretStr = Field(
        min_length=MIN_PASSWORD_LENGTH,
        max_length=128,
        description=f"Plain password (min {MIN_PASSWORD_LENGTH} characters).",
    )

    @field_validator("password")
    @classmethod
    def validate_password_strength(cls, v: SecretStr) -> SecretStr:
        raw = v.get_secret_value()
        if raw.strip() != raw:
            raise ValueError("password must not have leading or trailing whitespace")
        if not any(c.isalpha() for c in raw) or not any(c.isdigit() for c in raw):
            raise ValueError("password must contain at least one letter and one digit")
        return v


class UserLogin(BaseModel):
    """Authenticate with email and password."""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "email": "operator@example.com",
                "password": "secure-password-1",
            }
        }
    )

    email: EmailStr
    password: SecretStr = Field(min_length=1, max_length=128)


class UserResponse(BaseModel):
    """Authenticated user profile (``GET /me``)."""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "id": 1,
                "username": "grid_operator",
                "email": "operator@example.com",
                "is_active": True,
                "created_at": "2026-05-22T12:00:00+00:00",
            }
        }
    )

    id: int = Field(ge=1, description="Internal user id (JWT subject).")
    username: str = Field(description="Unique username.")
    email: EmailStr = Field(description="Registered email address.")
    is_active: bool = Field(default=True, description="Whether the account can authenticate.")
    created_at: datetime = Field(description="UTC account creation timestamp.")


class TokenResponse(BaseModel):
    """OAuth2-style bearer token response."""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                "token_type": "bearer",
                "expires_in": 3600,
                "user": {
                    "id": 1,
                    "username": "grid_operator",
                    "email": "operator@example.com",
                    "is_active": True,
                    "created_at": "2026-05-22T12:00:00+00:00",
                },
            }
        }
    )

    access_token: str = Field(description="JWT or opaque API access token.")
    token_type: Literal["bearer"] = "bearer"
    expires_in: int = Field(ge=1, description="Token lifetime in seconds.")
    user: UserResponse = Field(description="Authenticated user profile.")


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class ErrorResponse(BaseModel):
    """Standard HTTP error body."""

    detail: str = Field(description="Human-readable error message.")
