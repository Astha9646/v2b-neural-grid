"""
FastAPI backend for V2B DDPG smart charging inference.

Endpoints:
  GET  /health   — service & model status
  POST /predict  — real-time charging/discharging actions
  GET  /metrics  — cached evaluation metrics (from evaluate.py)
  POST /evaluate — run evaluation episode(s) on demand

Run:
  uvicorn backend.main:app --reload
  (host/port from backend/.env — API_HOST, API_PORT)
"""

from __future__ import annotations
import pandas as pd

import asyncio
import logging
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Ensure project root is on path when running as ``uvicorn backend.main:app``
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.auth import auth_router, require_authenticated_user
from backend.config import Settings, configure_logging, get_settings, settings
from backend.database import init_db
from backend.digital_twin import TwinScenario, digital_twin
from backend.forecasting import forecasting_engine
from backend.grid_intelligence import grid_intelligence
from backend.inference import model_service
from backend.rl_interfaces import policy_integration_payload
from backend.system_monitor import system_monitor
from backend.system_routes import system_router
from backend.report_routes import report_router
from backend.startup import run_startup_validation, shutdown_services, startup_health
from backend.telemetry_loader import load_telemetry_rows, resolve_dataset_path
from backend.websocket_manager import StreamChannel, grid_stream_manager
from backend.models import User
from backend.schemas import (
    EvaluateRequest,
    EvaluateResponse,
    ErrorResponse,
    HealthResponse,
    MetricsResponse,
    PredictRequest,
    PredictResponse,
    utc_now,
)

logger = logging.getLogger(__name__)

configure_logging(settings)


# ---------------------------------------------------------------------------
# Application lifespan — model caching on startup
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Production-safe bootstrap: validate optional resources, never crash on missing deps."""
    await asyncio.to_thread(init_db)
    logger.info(
        "Database ready (environment=%s require_auth=%s frontend=%s ws=%s)",
        settings.environment,
        settings.require_auth,
        settings.frontend_url,
        settings.resolved_ws_base_url,
    )
    await run_startup_validation(settings)
    if settings.is_railway:
        from backend.railway_config import log_railway_diagnostics, websocket_deploy_hints

        log_railway_diagnostics(settings)
        logger.info("Railway WebSocket endpoints: %s", websocket_deploy_hints(settings))
    yield
    await shutdown_services()


app = FastAPI(
    title=settings.api_title,
    version=settings.api_version,
    description=(
        "Vehicle-to-Building smart charging API powered by DDPG reinforcement learning. "
        "Serves real-time charging/discharging decisions for heterogeneous EV chargers."
    ),
    lifespan=lifespan,
    responses={
        500: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
    },
)

# CORS for frontend dashboards (environment-driven)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=settings.cors_origins_list != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(system_router)
app.include_router(report_router)


@app.middleware("http")
async def observability_middleware(request: Request, call_next):
    """Record API latency for observability (skip WebSocket upgrade paths)."""
    if request.url.path.startswith("/ws"):
        return await call_next(request)
    t0 = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    system_monitor.record_request(elapsed_ms)
    return response


def _require_model() -> None:
    """Deprecated guard — predict now uses heuristic fallback when model is unloaded."""
    if model_service.using_fallback:
        logger.debug("Predict using heuristic fallback: %s", model_service.fallback_reason)


def _health_status() -> str:
    report = startup_health.report
    if report.overall_status == "error":
        return "error"
    if model_service.is_loaded and report.overall_status == "ok":
        return "ok"
    return "degraded"


# ---------------------------------------------------------------------------
# 1) GET /health
# ---------------------------------------------------------------------------


@app.get("/healthz", tags=["system"])
async def healthz_liveness() -> dict[str, str]:
    """
    Railway / load-balancer liveness probe.

    Always returns HTTP 200 once the process is accepting traffic.
    Use ``/health`` for full component diagnostics.
    """
    return {"status": "alive", "environment": settings.environment}


@app.get("/health", response_model=HealthResponse, tags=["system"])
async def health_check() -> HealthResponse:
    """Check API and model loading status with startup component diagnostics."""
    return HealthResponse(
        status=_health_status(),
        model_loaded=model_service.is_loaded,
        timestamp=utc_now(),
        device=model_service.device if model_service.is_loaded else None,
        state_dim=model_service.state_dim if model_service.is_loaded else None,
        action_dim=model_service.action_dim if model_service.is_loaded else None,
        checkpoint=str(settings.checkpoint_dir_resolved) if model_service.is_loaded else None,
        startup=startup_health.report.to_dict(),
        inference_fallback=model_service.using_fallback,
    )


# ---------------------------------------------------------------------------
# 2) POST /predict
# ---------------------------------------------------------------------------


@app.post("/predict", response_model=PredictResponse, tags=["inference"])
async def predict(
    request: PredictRequest,
    _user: User = Depends(require_authenticated_user),
) -> PredictResponse:
    """
    Real-time DDPG inference: state → continuous charger actions.

    Input state must be normalized [0, 1] (23-dim ``StateBuilder`` vector).
    Output actions are tanh-bounded in [-1, 1]; optional kW after masking/scaling.
    """
    _require_model()

    try:
        state_vec = model_service.state_vector_from_request(
            request.state,
            request.resolved_state_features(),
            session_index=request.resolved_session_index(),
            elapsed_hours=request.resolved_elapsed_hours(),
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    t0 = time.perf_counter()
    try:
        actions_tanh, actions_kw, used_fallback = await asyncio.to_thread(
            model_service.predict,
            state_vec,
            explore=request.resolved_explore(),
            return_power_kw=request.resolved_return_power_kw(),
            mask_context=request.resolved_mask_context(),
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Prediction failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Inference error: {exc}",
        ) from exc

    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    system_monitor.record_inference(elapsed_ms)
    if used_fallback:
        logger.warning("Served heuristic fallback prediction: %s", model_service.fallback_reason)
    return PredictResponse(
        actions=actions_tanh.tolist(),
        actions_kw=actions_kw.tolist() if actions_kw is not None else None,
        inference_time_ms=round(elapsed_ms, 3),
        model_version=settings.api_version,
        timestamp=utc_now(),
        action_dim=model_service.action_dim,
        fallback=used_fallback,
        policy_source="heuristic_fallback" if used_fallback else "ddpg",
    )


# ---------------------------------------------------------------------------
# 3) GET /metrics
# ---------------------------------------------------------------------------

@app.get("/dataset")
def get_dataset():
    """
    Hourly smart-grid telemetry for dashboard charts.

    Path resolved from TELEMETRY_PATH / DATASET_PATH in backend/.env.
    """
    path, telemetry_path, _ = resolve_dataset_path()
    if not path.is_file():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Dataset not found. Run: python data/preprocess.py --mode telemetry",
        )

    df = pd.read_csv(path)
    df = df.fillna(0)
    limit = min(len(df), settings.telemetry_row_limit) if path == telemetry_path else min(len(df), 100)
    return df.head(limit).to_dict(orient="records")


# ---------------------------------------------------------------------------
# WebSocket real-time streams (paths from backend/.env)
# ---------------------------------------------------------------------------


@app.websocket(settings.ws_telemetry_path)
async def ws_telemetry(websocket: WebSocket):
    """Live telemetry row stream (snapshot on connect + tick updates)."""
    await grid_stream_manager.handle_connection(websocket, StreamChannel.TELEMETRY)


@app.websocket(settings.ws_forecast_path)
async def ws_forecast(websocket: WebSocket):
    """Rolling forecast updates."""
    await grid_stream_manager.handle_connection(websocket, StreamChannel.FORECAST)


@app.websocket(settings.ws_ai_path)
async def ws_ai(websocket: WebSocket):
    """AI inference, alerts, fleet, DDPG decisions, realtime events."""
    await grid_stream_manager.handle_connection(websocket, StreamChannel.AI)


# ---------------------------------------------------------------------------
# AI Operations Layer
# ---------------------------------------------------------------------------


@app.get("/ai/inference", tags=["ai"])
def ai_inference():
    """Telemetry-driven grid intelligence — decisions, strategies, confidence."""
    rows = load_telemetry_rows()
    if not rows:
        logger.warning("AI inference: telemetry unavailable — returning rule-engine fallback")
        return {
            "optimization_action": "maintain_charging_profile",
            "policy_source": "rule_engine_fallback",
            "ai_recommendation": "Telemetry unavailable — operating on safe defaults.",
            "risk_level": "medium",
            "confidence_score": 0.35,
            "fallback": True,
        }
    latest = rows[-1]
    history = rows[-48:]
    t0 = time.perf_counter()
    result = grid_intelligence.analyze_row(latest, history)
    system_monitor.record_inference((time.perf_counter() - t0) * 1000.0)
    payload = result.to_dict()
    payload["rl"] = policy_integration_payload(latest)
    policy = grid_intelligence._get_ddpg_policy()
    if policy is not None:
        payload["ddpg_actions"] = policy.predict(latest).get("actions", {})
        payload["policy_source"] = "ddpg_telemetry_actor"
    else:
        payload["policy_source"] = "rule_engine"
    # Explainability is attached in analyze_row; ensure nested block is present
    if not payload.get("explainability"):
        from backend.explainability import attach_explanation_to_inference

        payload = attach_explanation_to_inference(
            latest,
            payload,
            ddpg_actions=payload.get("ddpg_actions"),
            policy_source=payload.get("policy_source", "rule_engine"),
        )
    return payload


@app.get("/ai/forecast", tags=["ai"])
def ai_forecast(horizon: int = 6, window: int = 24):
    """Rolling-window forecasts for load, peak, renewable, SOC, charging."""
    rows = load_telemetry_rows()
    bundle = forecasting_engine.forecast_safe(rows, horizon=horizon, window=window)
    summary = forecasting_engine.summary_metrics(rows) if rows else {
        "load_trend_1h": 0,
        "load_ma_24": 0,
        "load_forecast_next": 0,
    }
    return {
        **bundle.to_dict(),
        "summary": summary,
        "fallback": forecasting_engine.using_fallback or not rows,
    }


@app.get("/ai/fleet", tags=["ai"])
def ai_fleet():
    """Live fleet snapshot derived from latest telemetry."""
    rows = load_telemetry_rows()
    if not rows:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Telemetry not available")
    return {"fleet": grid_intelligence.generate_fleet(rows[-1]), "timestamp": rows[-1].get("timestamp")}


@app.get("/ai/alerts", tags=["ai"])
def ai_alerts():
    """Dynamic operational alerts from telemetry thresholds."""
    rows = load_telemetry_rows()
    if not rows:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Telemetry not available")
    return {
        "alerts": grid_intelligence.generate_alerts(rows[-1], rows[-72:]),
        "timestamp": rows[-1].get("timestamp"),
    }


@app.get("/ai/activities", tags=["ai"])
def ai_activities():
    """AI operations timeline events."""
    rows = load_telemetry_rows()
    if not rows:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Telemetry not available")
    latest = rows[-1]
    history = rows[-24:]
    inference = grid_intelligence.analyze_row(latest, history)
    return {
        "activities": grid_intelligence.generate_activities(latest, history, inference),
        "timestamp": latest.get("timestamp"),
    }


@app.post("/ai/digital-twin/reset", tags=["ai"])
def ai_digital_twin_reset(scenario: str = "baseline"):
    """Reset digital twin to scenario baseline."""
    state = digital_twin.reset(TwinScenario(name=scenario))
    return state.to_dict()


@app.post("/ai/digital-twin/step", tags=["ai"])
def ai_digital_twin_step():
    """Advance digital twin simulation one tick."""
    return digital_twin.step().to_dict()


@app.post("/ai/train-ddpg", tags=["ai"])
def ai_train_ddpg(episodes: int = 100):
    """
    Train telemetry DDPG (long-running). Prefer CLI: ``python -m backend.rl.train_ddpg``.
    """
    from backend.rl.rl_config import default_config
    from backend.rl.train_ddpg import train

    cfg = default_config()
    cfg.num_episodes = episodes
    train(cfg)
    return {
        "status": "ok",
        "episodes": episodes,
        "actor_checkpoint": str(cfg.actor_checkpoint),
        "metrics_csv": str(cfg.metrics_csv_path),
    }


@app.get("/metrics", tags=["evaluation"])
async def get_metrics():
    """
    Return smart-grid dashboard metrics.
    """

    return [

        {
            "id": "active-evs",
            "title": "Active EVs",
            "value": 24,
            "unit": "",
            "subtitle": "Vehicles connected",
            "trend": "+12%",
            "accent": "cyan",
        },

        {
            "id": "grid-load",
            "title": "Grid Load",
            "value": 312,
            "unit": "kW",
            "subtitle": "Current building demand",
            "trend": "-4%",
            "accent": "emerald",
        },

        {
            "id": "solar-usage",
            "title": "Solar Usage",
            "value": 68,
            "unit": "%",
            "subtitle": "Renewable contribution",
            "trend": "+8%",
            "accent": "yellow",
        },

        {
            "id": "rl-reward",
            "title": "RL Reward",
            "value": 156.4,
            "unit": "",
            "subtitle": "Optimization reward",
            "trend": "+15%",
            "accent": "violet",
        },
    ]


# ---------------------------------------------------------------------------
# 4) POST /evaluate
# ---------------------------------------------------------------------------


@app.post("/evaluate", response_model=EvaluateResponse, tags=["evaluation"])
async def run_evaluation(
    request: EvaluateRequest,
    _user: User = Depends(require_authenticated_user),
) -> EvaluateResponse:
    """
    Run one or more evaluation episodes (integrates ``evaluate.py`` + ``ev_env``).

    Deterministic DDPG policy; optional random baseline comparison.
    Long-running operation — executed in a thread pool.
    """
    try:
        from evaluate import EvalConfig, run_evaluation as eval_run
    except ImportError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"evaluate module not available: {exc}",
        ) from exc

    checkpoint = (
        Path(request.checkpoint_dir)
        if request.checkpoint_dir
        else settings.checkpoint_dir_resolved
    )
    output_dir = (
        Path(request.output_dir)
        if request.output_dir
        else PROJECT_ROOT / "evaluation" / "api_run"
    )

    eval_cfg = EvalConfig(
        checkpoint_dir=checkpoint,
        output_dir=output_dir,
        num_episodes=request.num_episodes,
        num_chargers=request.num_chargers or settings.num_chargers,
        episode_slots=request.episode_slots or settings.episode_slots,
        run_baseline=request.run_baseline,
        env_seed=request.seed,
        seed=request.seed,
    )

    try:
        report = await asyncio.to_thread(eval_run, eval_cfg)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Evaluation failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Evaluation error: {exc}",
        ) from exc

    # Reload model if checkpoint changed
    if str(checkpoint) != str(settings.checkpoint_dir_resolved):
        settings.checkpoint_dir = checkpoint
        await asyncio.to_thread(model_service.shutdown)
        await asyncio.to_thread(model_service.load, settings)

    return EvaluateResponse.from_evaluation_report(
        report,
        output_dir=str(output_dir),
        num_episodes=request.num_episodes,
        message=f"Evaluation complete. Artifacts saved to {output_dir}",
    )


# ---------------------------------------------------------------------------
# Optional: live episode using ev_env (dashboard integration)
# ---------------------------------------------------------------------------


@app.post("/rollout", tags=["inference"])
async def rollout_episode(
    explore: bool = False,
    _user: User = Depends(require_authenticated_user),
) -> dict[str, Any]:
    """
    Run a single full episode in ``V2BChargingEnv`` with the loaded policy.

    Useful for dashboard demos without sending state vectors manually.
    """
    _require_model()
    if model_service._env is None or model_service._agent is None:
        raise HTTPException(status_code=503, detail="Environment not initialized")

    def _run() -> dict[str, Any]:
        env = model_service._env
        agent = model_service._agent
        state, _ = env.reset()
        agent.reset_noise()
        total_reward = 0.0
        steps = 0
        last_info: dict[str, Any] = {}

        while True:
            action = agent.select_action(state, explore=explore)
            next_state, reward, term, trunc, info = env.step(action)
            total_reward += float(reward)
            steps += 1
            last_info = info
            state = next_state
            if term or trunc:
                break

        return {
            "episode_reward": total_reward,
            "steps": steps,
            "peak_demand_kw": last_info.get("peak_demand"),
            "electricity_cost_usd": last_info.get("electricity_cost_cumulative_usd"),
            "renewable_utilization": last_info.get("renewable_utilization"),
        }

    return await asyncio.to_thread(_run)


@app.exception_handler(Exception)
async def global_exception_handler(_request: Any, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error: %s", exc)
    detail = str(exc) if settings.expose_error_details else "Internal server error"
    return JSONResponse(
        status_code=500,
        content={"detail": detail},
    )


def create_app(cfg: Settings | None = None) -> FastAPI:
    """Factory for testing with custom settings."""
    if cfg is not None:
        from backend import config as config_module

        config_module.settings = cfg
        get_settings.cache_clear()
    return app


if __name__ == "__main__":
    import uvicorn

    from backend.railway_config import log_railway_diagnostics

    configure_logging(settings)
    log_railway_diagnostics(settings)
    uvicorn.run(
        "backend.main:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=settings.is_development,
        proxy_headers=True,
        forwarded_allow_ips="*",
    )
