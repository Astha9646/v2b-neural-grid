import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useObservability } from "../context/ObservabilityContext";
import { useStreamMeta } from "../hooks/useTelemetrySelectors";
import { RECHARTS_PERF } from "../utils/chartUtils";
import { LatencyMeter, NeonMeter, UptimeCounter } from "./observability/NeonMeter";

const MAX_HISTORY = 24;

const StreamIndicator = memo(function StreamIndicator({ channel, count, state, managerRunning }) {
  const live = managerRunning && (state === "open" || count > 0);
  return (
    <div
      className={[
        "flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2",
        live ? "border-emerald-500/25 bg-emerald-500/5" : "border-slate-700/40 bg-slate-900/40",
      ].join(" ")}
    >
      <span className="relative flex h-2 w-2 shrink-0">
        {live ? (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
        ) : null}
        <span
          className={[
            "relative h-2 w-2 rounded-full",
            live ? "bg-emerald-400" : "bg-slate-600",
          ].join(" ")}
        />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {channel}
        </p>
        <p className="font-mono text-xs font-bold text-slate-200">{count} clients</p>
      </div>
    </div>
  );
});

const ThroughputChart = memo(function ThroughputChart({ history }) {
  if (!history.length) {
    return (
      <div className="flex h-[180px] items-center justify-center text-xs text-slate-500">
        Collecting throughput samples…
      </div>
    );
  }

  return (
    <div className="h-[180px] min-w-0 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={history} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="streamGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.45} />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="4 8" stroke="rgba(148,163,184,0.08)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: "#64748b", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} width={32} />
          <Tooltip
            contentStyle={{
              background: "rgba(15,23,42,0.95)",
              border: "1px solid rgba(34,211,238,0.3)",
              borderRadius: 12,
              fontSize: 11,
            }}
          />
          <Area
            type="monotone"
            dataKey="streamRate"
            name="Stream msg/s"
            stroke="#22d3ee"
            fill="url(#streamGrad)"
            strokeWidth={2}
            dot={false}
            {...RECHARTS_PERF}
          />
          <Area
            type="monotone"
            dataKey="rps"
            name="HTTP req/s"
            stroke="#a78bfa"
            fill="transparent"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            dot={false}
            {...RECHARTS_PERF}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
});

function InfrastructureMetricsInner({ className = "" }) {
  const { metrics, health, performance, loading, error, historyPoint } = useObservability();
  const { isStreaming, streamStatus } = useStreamMeta();
  const [history, setHistory] = useState([]);
  const lastHistoryKeyRef = useRef("");

  useEffect(() => {
    if (!historyPoint) return;
    const key = `${historyPoint.t}-${historyPoint.streamRate}-${historyPoint.rps}`;
    if (key === lastHistoryKeyRef.current) return;
    lastHistoryKeyRef.current = key;

    const label = new Date(historyPoint.t).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    setHistory((prev) => [...prev, { ...historyPoint, label }].slice(-MAX_HISTORY));
  }, [historyPoint]);

  const wsChannels = useMemo(
    () => metrics?.websocket_by_channel ?? {},
    [metrics?.websocket_by_channel],
  );

  const managerRunning =
    health?.stream_manager_running ?? metrics?.stream_manager_running ?? false;

  if (loading && !health) {
    return (
      <section className={["panel-shell min-h-[320px] animate-pulse", className].join(" ")}>
        <div className="h-4 w-1/3 rounded bg-slate-700/50" />
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-slate-800/40" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section
      className={[
        "relative min-w-0 overflow-hidden rounded-2xl border border-cyan-500/15",
        "bg-gradient-to-br from-slate-950/90 via-slate-950/70 to-cyan-950/20 p-5 backdrop-blur-md",
        className,
      ].join(" ")}
      aria-labelledby="infra-metrics-title"
    >
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="section-eyebrow">Observability</p>
          <h2 id="infra-metrics-title" className="section-heading">
            Infrastructure Metrics
          </h2>
          <p className="section-subheading">Host resources · WebSocket pools · stream throughput</p>
        </div>
        <div
          className={[
            "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider",
            isStreaming && managerRunning
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-slate-600/40 bg-slate-900/50 text-slate-500",
          ].join(" ")}
        >
          <span className="relative flex h-2 w-2">
            {isStreaming && managerRunning ? (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
            ) : null}
            <span
              className={[
                "relative h-2 w-2 rounded-full",
                isStreaming && managerRunning ? "bg-emerald-400" : "bg-slate-600",
              ].join(" ")}
            />
          </span>
          {isStreaming && managerRunning ? "WS Live" : "WS Offline"}
        </div>
      </header>

      {error ? (
        <p className="mb-4 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
          {error}
        </p>
      ) : null}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <NeonMeter
          label="CPU"
          value={metrics?.cpu_percent ?? 0}
          accent={(metrics?.cpu_percent ?? 0) > 85 ? "rose" : "cyan"}
        />
        <NeonMeter
          label="RAM"
          value={metrics?.ram_percent ?? 0}
          accent={(metrics?.ram_percent ?? 0) > 90 ? "rose" : "emerald"}
        />
        <NeonMeter
          label="GPU"
          value={metrics?.gpu_percent ?? 0}
          accent="violet"
          sublabel={metrics?.gpu_name ?? (metrics?.gpu_available ? "CUDA" : "CPU-only")}
        />
        <NeonMeter
          label="Disk"
          value={metrics?.disk_percent ?? 0}
          accent="amber"
        />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {["telemetry", "forecast", "ai"].map((ch) => (
          <StreamIndicator
            key={ch}
            channel={ch}
            count={wsChannels[ch] ?? 0}
            state={streamStatus?.[ch]}
            managerRunning={managerRunning}
          />
        ))}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <LatencyMeter
          label="API health"
          ms={health?.api_latency_ms ?? 0}
          p95={performance?.api?.p95_ms ?? metrics?.api_latency_p95_ms ?? 0}
        />
        <LatencyMeter
          label="AI inference"
          ms={health?.inference_latency_ms ?? 0}
          p95={performance?.inference?.p95_ms ?? metrics?.inference_latency_p95_ms ?? 0}
          warnMs={150}
          critMs={400}
        />
        <LatencyMeter
          label="Forecast engine"
          ms={health?.forecast_latency_ms ?? metrics?.forecast_latency_ms ?? 0}
          p95={performance?.forecast?.p95_ms ?? metrics?.forecast_latency_p95_ms ?? 0}
          warnMs={180}
          critMs={450}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Stream throughput
          </p>
          <ThroughputChart history={history} />
        </div>
        <div className="min-w-0 space-y-3">
          <UptimeCounter
            uptime={health?.uptime ?? metrics?.uptime}
            uptimeSeconds={health?.uptime_seconds ?? metrics?.uptime_seconds}
            status={health?.status}
          />
          <div className="rounded-xl border border-white/5 bg-slate-900/40 p-3">
            <p className="metric-label">Telemetry throughput</p>
            <p className="mt-1 font-mono text-xl font-bold text-cyan-300">
              {(metrics?.telemetry_throughput ?? health?.stream_rate ?? 0).toFixed(2)}
              <span className="text-sm text-slate-500"> msg/s</span>
            </p>
          </div>
          <div className="rounded-xl border border-violet-500/15 bg-violet-500/5 p-3">
            <p className="metric-label">HTTP requests</p>
            <p className="mt-1 font-mono text-lg font-bold text-violet-200">
              {(health?.requests_per_second ?? 0).toFixed(2)}
              <span className="text-sm text-slate-500"> req/s</span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

const InfrastructureMetrics = memo(InfrastructureMetricsInner);
InfrastructureMetrics.displayName = "InfrastructureMetrics";

export default InfrastructureMetrics;
