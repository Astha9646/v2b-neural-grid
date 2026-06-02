/**
 * System observability API client — deduplicated parallel fetches for ops dashboards.
 */

import api from "./api";
import env from "../config/env";

const CACHE_MS = 2_500;
let bundleInflight = null;
let bundleCache = null;
let bundleCacheAt = 0;

async function fetchEndpoint(path) {
  const response = await api.get(path);
  return response.data;
}

/**
 * Single coalesced bundle fetch (health + metrics + performance in parallel).
 */
export async function fetchObservabilityBundle() {
  const now = Date.now();
  if (bundleInflight) return bundleInflight;
  if (bundleCache && now - bundleCacheAt < CACHE_MS) {
    return bundleCache;
  }

  bundleInflight = Promise.all([
    fetchEndpoint("/system/health"),
    fetchEndpoint("/system/metrics"),
    fetchEndpoint("/system/performance"),
  ])
    .then(([health, metrics, performance]) => {
      const bundle = { health, metrics, performance };
      bundleCache = bundle;
      bundleCacheAt = Date.now();
      return bundle;
    })
    .finally(() => {
      bundleInflight = null;
    });

  return bundleInflight;
}

export async function fetchSystemHealth() {
  const bundle = await fetchObservabilityBundle();
  return bundle.health;
}

export async function fetchSystemMetrics() {
  const bundle = await fetchObservabilityBundle();
  return bundle.metrics;
}

export async function fetchSystemPerformance() {
  const bundle = await fetchObservabilityBundle();
  return bundle.performance;
}

export function mapHealthToPanel(health, metrics, performance) {
  if (!health) return null;

  const statusMap = {
    operational: "online",
    degraded: "degraded",
    critical: "offline",
  };

  const overall = health.status ?? "operational";
  const wsByChannel = metrics?.websocket_by_channel ?? {};

  return {
    overall,
    lastChecked: health.checked_at ?? new Date().toISOString(),
    uptimePct: metrics?.uptime_seconds
      ? Math.min(99.99, 99.0 + Math.min(0.99, metrics.uptime_seconds / 86400))
      : 99.9,
    uptimeLabel: health.uptime ?? metrics?.uptime ?? "—",
    core: {
      cpu: health.cpu_percent ?? 0,
      ram: health.ram_percent ?? 0,
      gpu: health.gpu_percent ?? 0,
      disk: metrics?.disk_percent ?? 0,
      wsClients: health.websocket_clients ?? 0,
      rps: health.requests_per_second ?? 0,
      streamRate: health.stream_rate ?? 0,
      telemetryThroughput: health.telemetry_throughput ?? metrics?.telemetry_throughput ?? 0,
      apiLatency: health.api_latency_ms ?? 0,
      inferenceLatency: health.inference_latency_ms ?? 0,
      forecastLatency: health.forecast_latency_ms ?? metrics?.forecast_latency_ms ?? 0,
    },
    wsChannels: wsByChannel,
    streamManagerRunning: health.stream_manager_running ?? metrics?.stream_manager_running ?? false,
    performance: performance?.throughput ?? {},
    api: performance?.api ?? {},
    inference: performance?.inference ?? {},
    forecast: performance?.forecast ?? {},
    services: [
      {
        id: "api",
        name: "Backend API",
        status: statusMap[overall] ?? "online",
        latencyMs: Math.round(health.api_latency_ms ?? 0),
        latencyP99Ms: Math.round(performance?.api?.p99_ms ?? 0),
        detail: `${(health.requests_per_second ?? 0).toFixed?.(2) ?? health.requests_per_second ?? 0} req/s · FastAPI`,
        endpoint: env.apiBaseUrl || "—",
      },
      {
        id: "model",
        name: "RL Model",
        status: health.model_loaded ? "online" : "degraded",
        latencyMs: Math.round(health.inference_latency_ms ?? 0),
        detail: health.model_loaded ? "DDPG Actor loaded" : "Heuristic fallback",
        checkpoint: "checkpoints/quick_test/best/actor.pt",
      },
      {
        id: "inference",
        name: "AI Inference",
        status: (health.inference_latency_ms ?? 0) < 200 ? "online" : "degraded",
        latencyMs: Math.round(health.inference_latency_ms ?? 0),
        latencyP99Ms: Math.round(performance?.inference?.p99_ms ?? 0),
        detail: `p95 ${Math.round(performance?.inference?.p95_ms ?? 0)} ms`,
      },
      {
        id: "forecast",
        name: "Forecast Engine",
        status: (health.forecast_latency_ms ?? 0) < 250 ? "online" : "degraded",
        latencyMs: Math.round(health.forecast_latency_ms ?? metrics?.forecast_latency_ms ?? 0),
        latencyP99Ms: Math.round(performance?.forecast?.p99_ms ?? 0),
        detail: `p95 ${Math.round(performance?.forecast?.p95_ms ?? 0)} ms · rolling horizon`,
      },
      {
        id: "streams",
        name: "WebSocket Streams",
        status:
          (health.stream_manager_running ?? metrics?.stream_manager_running)
            ? health.websocket_clients > 0
              ? "online"
              : "degraded"
            : "offline",
        latencyMs: Math.round((health.stream_rate ?? 0) * 10) / 10,
        detail: `telemetry ${wsByChannel.telemetry ?? 0} · forecast ${wsByChannel.forecast ?? 0} · ai ${wsByChannel.ai ?? 0}`,
        connections: health.websocket_clients ?? 0,
      },
    ],
  };
}
