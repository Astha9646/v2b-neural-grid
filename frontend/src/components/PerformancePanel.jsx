import { memo, useMemo } from "react";

import { useObservability } from "../context/ObservabilityContext";
import { LatencyMeter, NeonMeter } from "./observability/NeonMeter";

function GpuCard({ metrics }) {
  const available = metrics?.gpu_available;
  const name = metrics?.gpu_name ?? "No CUDA device";

  return (
    <div className="min-w-0 rounded-xl border border-violet-500/20 bg-violet-950/20 p-4">
      <p className="metric-label text-violet-400/80">GPU accelerator</p>
      <p className="mt-1 truncate font-mono text-sm font-semibold text-violet-200">{name}</p>
      {available ? (
        <div className="mt-4 space-y-3">
          <NeonMeter
            label="GPU utilization"
            value={metrics.gpu_percent ?? 0}
            accent="violet"
          />
          <NeonMeter
            label="VRAM"
            value={metrics.gpu_memory_percent ?? 0}
            accent="violet"
            sublabel="Device memory allocated"
          />
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-500">Inference running on CPU</p>
      )}
    </div>
  );
}

function PerformancePanelInner({ className = "" }) {
  const { health, metrics, performance, loading, error, refresh } = useObservability();

  const throughput = useMemo(
    () => performance?.throughput ?? {},
    [performance?.throughput],
  );

  if (loading && !health) {
    return (
      <section className={["panel-shell min-h-[280px] animate-pulse", className].join(" ")} />
    );
  }

  return (
    <section
      className={[
        "relative min-w-0 overflow-hidden rounded-2xl border border-violet-500/20",
        "bg-gradient-to-br from-violet-950/25 via-slate-950/80 to-slate-950/90 p-5 backdrop-blur-md",
        className,
      ].join(" ")}
      aria-labelledby="performance-panel-title"
    >
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="section-eyebrow text-violet-400/80">Performance</p>
          <h2 id="performance-panel-title" className="section-heading">
            Latency &amp; Throughput
          </h2>
          <p className="section-subheading">API · RL inference · forecast · stream cadence</p>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="shrink-0 rounded-lg border border-violet-500/25 bg-violet-500/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-violet-200 hover:bg-violet-500/20"
        >
          Refresh
        </button>
      </header>

      {error ? (
        <p className="mb-4 text-xs text-amber-300">{error}</p>
      ) : null}

      <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-3">
        <LatencyMeter
          label="API latency"
          ms={health?.api_latency_ms ?? performance?.api?.avg_ms ?? 0}
          p95={performance?.api?.p95_ms ?? metrics?.api_latency_p95_ms ?? 0}
        />
        <LatencyMeter
          label="RL inference"
          ms={health?.inference_latency_ms ?? performance?.inference?.avg_ms ?? 0}
          p95={performance?.inference?.p95_ms ?? metrics?.inference_latency_p95_ms ?? 0}
          warnMs={150}
          critMs={400}
        />
        <LatencyMeter
          label="Forecast engine"
          ms={health?.forecast_latency_ms ?? performance?.forecast?.avg_ms ?? metrics?.forecast_latency_ms ?? 0}
          p95={performance?.forecast?.p95_ms ?? metrics?.forecast_latency_p95_ms ?? 0}
          warnMs={180}
          critMs={450}
        />
      </div>

      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="card-body rounded-xl border border-white/5 bg-slate-900/40 p-3">
          <p className="metric-label">HTTP req/s</p>
          <p className="metric-value text-cyan-300">
            {(throughput.requests_per_second ?? health?.requests_per_second ?? 0).toFixed(2)}
          </p>
        </div>
        <div className="card-body rounded-xl border border-white/5 bg-slate-900/40 p-3">
          <p className="metric-label">Stream rate</p>
          <p className="metric-value text-emerald-300">
            {(throughput.stream_rate ?? health?.stream_rate ?? 0).toFixed(2)}
          </p>
        </div>
        <div className="card-body rounded-xl border border-white/5 bg-slate-900/40 p-3">
          <p className="metric-label">WS clients</p>
          <p className="metric-value text-violet-300">{health?.websocket_clients ?? 0}</p>
        </div>
        <div className="card-body rounded-xl border border-white/5 bg-slate-900/40 p-3">
          <p className="metric-label">Active channels</p>
          <p className="metric-value text-amber-300">{metrics?.active_streams ?? 0}</p>
        </div>
      </div>

      <GpuCard metrics={metrics} />
    </section>
  );
}

const PerformancePanel = memo(PerformancePanelInner);
PerformancePanel.displayName = "PerformancePanel";

export default PerformancePanel;
