"""
Production-grade system observability for V2B Neural Grid.

Tracks host resources, API/inference/forecast latency, WebSocket throughput, and uptime.
Thread-safe rolling windows; safe when psutil/CUDA are unavailable.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

try:
    import psutil
except ImportError:  # pragma: no cover
    psutil = None  # type: ignore[assignment]

try:
    import torch
except ImportError:  # pragma: no cover
    torch = None  # type: ignore[assignment]

MAX_SAMPLES = 512
RPS_WINDOW_SEC = 60.0
STREAM_WINDOW_SEC = 60.0


def _percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, int(round((pct / 100.0) * (len(ordered) - 1)))))
    return float(ordered[idx])


def _avg(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


@dataclass
class SystemMonitor:
    """Singleton-style monitor; use ``system_monitor`` module export."""

    _started_at: float = field(default_factory=time.time)
    _lock: threading.Lock = field(default_factory=threading.Lock)
    _api_latencies: deque[float] = field(default_factory=lambda: deque(maxlen=MAX_SAMPLES))
    _inference_latencies: deque[float] = field(default_factory=lambda: deque(maxlen=MAX_SAMPLES))
    _forecast_latencies: deque[float] = field(default_factory=lambda: deque(maxlen=MAX_SAMPLES))
    _request_times: deque[float] = field(default_factory=lambda: deque(maxlen=MAX_SAMPLES))
    _stream_events: deque[tuple[float, int]] = field(default_factory=lambda: deque(maxlen=MAX_SAMPLES))
    _cpu_initialized: bool = False

    # ------------------------------------------------------------------
    # Recording hooks (called from middleware / inference / WS loop)
    # ------------------------------------------------------------------

    def record_request(self, latency_ms: float) -> None:
        now = time.monotonic()
        with self._lock:
            self._api_latencies.append(float(latency_ms))
            self._request_times.append(now)

    def record_inference(self, latency_ms: float) -> None:
        with self._lock:
            self._inference_latencies.append(float(latency_ms))

    def record_forecast(self, latency_ms: float) -> None:
        with self._lock:
            self._forecast_latencies.append(float(latency_ms))

    def record_stream_broadcast(self, messages: int = 1) -> None:
        with self._lock:
            self._stream_events.append((time.monotonic(), max(1, int(messages))))

    # ------------------------------------------------------------------
    # Host metrics
    # ------------------------------------------------------------------

    def _cpu_percent(self) -> float:
        if psutil is None:
            return 0.0
        if not self._cpu_initialized:
            psutil.cpu_percent(interval=None)
            self._cpu_initialized = True
        return float(psutil.cpu_percent(interval=None))

    def _ram_percent(self) -> float:
        if psutil is None:
            return 0.0
        return float(psutil.virtual_memory().percent)

    def _disk_percent(self) -> float:
        if psutil is None:
            return 0.0
        try:
            return float(psutil.disk_usage("/").percent)
        except OSError:
            return 0.0

    def _gpu_metrics(self) -> dict[str, Any]:
        if torch is None or not torch.cuda.is_available():
            return {
                "gpu_percent": 0.0,
                "gpu_available": False,
                "gpu_name": None,
                "gpu_memory_percent": 0.0,
            }

        name = torch.cuda.get_device_name(0)
        mem_alloc = float(torch.cuda.memory_allocated(0))
        mem_total = float(torch.cuda.get_device_properties(0).total_memory)
        mem_pct = (mem_alloc / mem_total * 100.0) if mem_total > 0 else 0.0

        util_pct = mem_pct
        if hasattr(torch.cuda, "utilization"):
            try:
                util_pct = float(torch.cuda.utilization(0))
            except Exception:
                util_pct = mem_pct

        return {
            "gpu_percent": round(util_pct, 2),
            "gpu_available": True,
            "gpu_name": name,
            "gpu_memory_percent": round(mem_pct, 2),
        }

    # ------------------------------------------------------------------
    # Derived metrics
    # ------------------------------------------------------------------

    def _latency_stats(self, samples: deque[float]) -> dict[str, float]:
        with self._lock:
            vals = list(samples)
        if not vals:
            return {"avg_ms": 0.0, "p50_ms": 0.0, "p95_ms": 0.0, "p99_ms": 0.0}
        return {
            "avg_ms": round(_avg(vals), 3),
            "p50_ms": round(_percentile(vals, 50), 3),
            "p95_ms": round(_percentile(vals, 95), 3),
            "p99_ms": round(_percentile(vals, 99), 3),
        }

    def _requests_per_second(self) -> float:
        with self._lock:
            times = list(self._request_times)
        if not times:
            return 0.0
        cutoff = time.monotonic() - RPS_WINDOW_SEC
        recent = [t for t in times if t >= cutoff]
        if not recent:
            return 0.0
        span = max(time.monotonic() - min(recent), 1.0)
        return round(len(recent) / span, 3)

    def _stream_rate(self) -> float:
        """Broadcast messages per second over the rolling window."""
        with self._lock:
            events = list(self._stream_events)
        if not events:
            return 0.0
        cutoff = time.monotonic() - STREAM_WINDOW_SEC
        recent = [(t, n) for t, n in events if t >= cutoff]
        if not recent:
            return 0.0
        total_msgs = sum(n for _, n in recent)
        span = max(time.monotonic() - min(t for t, _ in recent), 1.0)
        return round(total_msgs / span, 3)

    def _telemetry_throughput(self) -> float:
        """Alias: stream messages/sec (telemetry + forecast + ai broadcasts)."""
        return self._stream_rate()

    def uptime_seconds(self) -> float:
        return max(0.0, time.time() - self._started_at)

    @staticmethod
    def format_uptime(seconds: float) -> str:
        s = int(seconds)
        days, rem = divmod(s, 86400)
        hours, rem = divmod(rem, 3600)
        minutes, secs = divmod(rem, 60)
        if days:
            return f"{days}d {hours}h {minutes}m"
        if hours:
            return f"{hours}h {minutes}m {secs}s"
        return f"{minutes}m {secs}s"

    def _overall_status(
        self,
        *,
        cpu: float,
        ram: float,
        model_loaded: bool,
        ws_clients: int,
        stream_manager_running: bool,
    ) -> str:
        if cpu >= 95 or ram >= 95:
            return "critical"
        if not stream_manager_running:
            return "degraded"
        if not model_loaded:
            return "degraded"
        if cpu >= 85 or ram >= 90:
            return "degraded"
        if ws_clients == 0:
            return "degraded"
        return "operational"

    def _build_snapshot(
        self,
        *,
        websocket_clients: int = 0,
        websocket_by_channel: dict[str, int] | None = None,
        active_streams: int = 0,
        model_loaded: bool = False,
        stream_manager_running: bool = False,
        stream_manager_enabled: bool = True,
    ) -> dict[str, Any]:
        cpu = self._cpu_percent()
        ram = self._ram_percent()
        disk = self._disk_percent()
        gpu = self._gpu_metrics()
        api_stats = self._latency_stats(self._api_latencies)
        inf_stats = self._latency_stats(self._inference_latencies)
        fc_stats = self._latency_stats(self._forecast_latencies)
        uptime_sec = self.uptime_seconds()
        rps = self._requests_per_second()
        stream_rate = self._stream_rate()
        status = self._overall_status(
            cpu=cpu,
            ram=ram,
            model_loaded=model_loaded,
            ws_clients=websocket_clients,
            stream_manager_running=stream_manager_running,
        )

        return {
            "cpu_percent": round(cpu, 2),
            "ram_percent": round(ram, 2),
            "disk_percent": round(disk, 2),
            "gpu_percent": gpu["gpu_percent"],
            "gpu_available": gpu["gpu_available"],
            "gpu_name": gpu["gpu_name"],
            "gpu_memory_percent": gpu["gpu_memory_percent"],
            "websocket_clients": websocket_clients,
            "websocket_by_channel": websocket_by_channel or {},
            "api_latency_ms": api_stats["avg_ms"],
            "api_latency_p95_ms": api_stats["p95_ms"],
            "inference_latency_ms": inf_stats["avg_ms"],
            "inference_latency_p95_ms": inf_stats["p95_ms"],
            "forecast_latency_ms": fc_stats["avg_ms"],
            "forecast_latency_p95_ms": fc_stats["p95_ms"],
            "uptime_seconds": round(uptime_sec, 1),
            "uptime": self.format_uptime(uptime_sec),
            "stream_rate": stream_rate,
            "telemetry_throughput": self._telemetry_throughput(),
            "requests_per_second": rps,
            "active_streams": active_streams,
            "stream_manager_running": stream_manager_running,
            "stream_manager_enabled": stream_manager_enabled,
            "model_loaded": model_loaded,
            "status": status,
            "timestamp": time.time(),
        }

    # ------------------------------------------------------------------
    # Public snapshots (async-safe; no blocking I/O beyond psutil)
    # ------------------------------------------------------------------

    async def snapshot(self, **kwargs: Any) -> dict[str, Any]:
        """Full observability snapshot for API responses."""
        return self._build_snapshot(**kwargs)

    async def health_snapshot(self, **kwargs: Any) -> dict[str, Any]:
        snap = self._build_snapshot(**kwargs)
        return {
            "status": snap["status"],
            "cpu_percent": snap["cpu_percent"],
            "ram_percent": snap["ram_percent"],
            "gpu_percent": snap["gpu_percent"],
            "websocket_clients": snap["websocket_clients"],
            "api_latency_ms": snap["api_latency_ms"],
            "inference_latency_ms": snap["inference_latency_ms"],
            "forecast_latency_ms": snap["forecast_latency_ms"],
            "uptime": snap["uptime"],
            "uptime_seconds": snap["uptime_seconds"],
            "stream_rate": snap["stream_rate"],
            "telemetry_throughput": snap["telemetry_throughput"],
            "requests_per_second": snap["requests_per_second"],
            "model_loaded": snap["model_loaded"],
            "stream_manager_running": snap["stream_manager_running"],
            "timestamp": snap["timestamp"],
        }

    async def metrics_snapshot(self, **kwargs: Any) -> dict[str, Any]:
        return await self.snapshot(**kwargs)

    async def performance_snapshot(self, **kwargs: Any) -> dict[str, Any]:
        snap = self._build_snapshot(**kwargs)
        api_stats = self._latency_stats(self._api_latencies)
        inf_stats = self._latency_stats(self._inference_latencies)
        fc_stats = self._latency_stats(self._forecast_latencies)
        return {
            **snap,
            "api": api_stats,
            "inference": inf_stats,
            "forecast": fc_stats,
            "throughput": {
                "requests_per_second": snap["requests_per_second"],
                "stream_rate": snap["stream_rate"],
                "telemetry_throughput": snap["telemetry_throughput"],
            },
        }


system_monitor = SystemMonitor()


def _instrument_forecasting_engine() -> None:
    """Patch forecast_safe to record latency without modifying forecasting module."""
    try:
        from backend.forecasting import forecasting_engine

        if getattr(forecasting_engine, "_observability_patched", False):
            return

        original = forecasting_engine.forecast_safe

        def forecast_safe_observed(*args: Any, **kwargs: Any):
            t0 = time.perf_counter()
            try:
                return original(*args, **kwargs)
            finally:
                system_monitor.record_forecast((time.perf_counter() - t0) * 1000.0)

        forecasting_engine.forecast_safe = forecast_safe_observed  # type: ignore[method-assign]
        forecasting_engine._observability_patched = True
        logger.debug("Forecasting engine instrumented for observability")
    except Exception as exc:
        logger.debug("Forecast instrumentation skipped: %s", exc)


_instrument_forecasting_engine()
