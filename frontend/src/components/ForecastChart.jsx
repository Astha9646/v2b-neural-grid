import { memo, useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useForecastSlice } from "../hooks/useTelemetrySelectors";
import { computeYDomain, logChartDebug, RECHARTS_PERF } from "../utils/chartUtils";
import { ChartSkeleton, StreamBadge, TelemetryError } from "./telemetry/TelemetryStates";

const CHART_HEIGHT = 320;

const COLORS = {
  load: "#22d3ee",
  charging: "#a78bfa",
  soc: "#34d399",
  stress: "#f97316",
  grid: "rgba(148, 163, 184, 0.08)",
  axis: "#64748b",
};

function ForecastTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  const get = (key) => payload.find((p) => p.dataKey === key)?.value;

  return (
    <div className="rounded-xl border border-cyan-500/30 bg-slate-950/95 px-3 py-2.5 shadow-lg backdrop-blur-md">
      <p className="text-xs font-semibold text-cyan-300">{label}</p>
      <ul className="mt-2 space-y-1 text-[11px] text-slate-300">
        <li>
          <span className="text-cyan-400">Load</span>{" "}
          <span className="font-mono font-bold">{Number(get("load_kw") ?? 0).toFixed(1)} kW</span>
        </li>
        <li>
          <span className="text-violet-400">Charging</span>{" "}
          <span className="font-mono font-bold">{Number(get("charging_demand_kw") ?? 0).toFixed(1)} kW</span>
        </li>
        <li>
          <span className="text-emerald-400">SOC</span>{" "}
          <span className="font-mono font-bold">{Number(get("soc_percent") ?? 0).toFixed(1)}%</span>
        </li>
        <li>
          <span className="text-orange-400">Stress</span>{" "}
          <span className="font-mono font-bold">{(Number(get("stress_pct") ?? 0)).toFixed(0)}%</span>
        </li>
      </ul>
    </div>
  );
}

function TrendIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 18l5-6 4 3 7-10 4 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ForecastChartInner({ className = "" }) {
  const {
    forecast,
    forecastLoading,
    forecastError,
    forecastLive,
    forecastLastUpdated,
    refreshForecast,
    isStreaming,
    streamStatus,
    lastUpdated,
  } = useForecastSlice();

  const chartData = useMemo(() => {
    const series = forecast?.chartSeries ?? [];
    const mapped = series.map((row) => ({
      ...row,
      stress_pct: Math.round(num(row.stress) * 100),
    }));
    logChartDebug("ForecastChart", mapped);
    return mapped;
  }, [forecast?.chartSeries]);

  const confidencePct = useMemo(
    () => Math.round((Number(forecast?.confidence) || 0) * 100),
    [forecast?.confidence],
  );

  const yMaxKw = useMemo(() => {
    const values = chartData.flatMap((d) => [d.load_kw, d.charging_demand_kw].map(Number).filter(Number.isFinite));
    const [min, max] = computeYDomain(values, { floor: 0, minSpan: 15 });
    return max;
  }, [chartData]);

  if (forecastLoading && !chartData.length) {
    return <ChartSkeleton className={className} label="Loading predictive forecast…" />;
  }

  if (forecastError && !chartData.length) {
    return (
      <TelemetryError
        message={forecastError}
        onRetry={refreshForecast}
        className={className}
      />
    );
  }

  return (
    <section
      className={[
        "relative min-w-0 overflow-hidden rounded-2xl border border-violet-500/20",
        "bg-gradient-to-br from-slate-950/90 via-slate-950/70 to-violet-950/20 p-5 backdrop-blur-md",
        className,
      ].join(" ")}
      aria-labelledby="forecast-chart-title"
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-400/50 to-cyan-400/30"
        aria-hidden
      />

      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/15 ring-1 ring-violet-400/30">
            <TrendIcon className="h-5 w-5 text-violet-400" />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-400/80">
              Predictive intelligence
            </p>
            <h3 id="forecast-chart-title" className="text-lg font-bold text-white">
              Multi-Horizon Grid Forecast
            </h3>
            <p className="text-sm text-slate-400">
              Load, charging demand, SOC trajectory, and stress projection
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StreamBadge
            isStreaming={isStreaming}
            streamStatus={streamStatus}
            lastUpdated={forecastLastUpdated ?? lastUpdated}
          />
          <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-center">
            <p className="text-[9px] uppercase tracking-wider text-slate-500">Model confidence</p>
            <p className="font-mono text-sm font-bold text-cyan-300">{confidencePct}%</p>
          </div>
        </div>
      </header>

      {(forecast?.insights ?? []).slice(0, 2).map((text) => (
        <p
          key={text}
          className="mb-2 rounded-lg border border-violet-500/15 bg-violet-500/5 px-3 py-2 text-xs leading-relaxed text-violet-100/90"
        >
          {text}
        </p>
      ))}

      <div className="mb-3 flex flex-wrap gap-3 text-[10px] uppercase tracking-wider text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-sm bg-cyan-400" />
          Load kW
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-sm bg-violet-400" />
          Charging kW
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-sm bg-emerald-400" />
          SOC %
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-sm bg-orange-500/60" />
          Stress
        </span>
      </div>

      <div className="w-full min-w-0" style={{ height: CHART_HEIGHT }}>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <defs>
                <linearGradient id="stressGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f97316" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#f97316" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="4 8" stroke={COLORS.grid} vertical={false} />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fill: COLORS.axis, fontSize: 11 }}
              />
              <YAxis
                yAxisId="kw"
                axisLine={false}
                tickLine={false}
                tick={{ fill: COLORS.axis, fontSize: 11 }}
                domain={[0, yMaxKw]}
                width={42}
              />
              <YAxis
                yAxisId="pct"
                orientation="right"
                axisLine={false}
                tickLine={false}
                tick={{ fill: COLORS.axis, fontSize: 11 }}
                domain={[0, 100]}
                width={36}
              />
              <Tooltip content={<ForecastTooltip />} />
              <Legend wrapperStyle={{ display: "none" }} />
              <Area
                yAxisId="pct"
                type="monotone"
                dataKey="stress_pct"
                fill="url(#stressGrad)"
                stroke="#f97316"
                strokeWidth={1}
                {...RECHARTS_PERF}
              />
              <Line
                yAxisId="kw"
                type="monotone"
                dataKey="load_kw"
                stroke={COLORS.load}
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 4, fill: COLORS.load }}
                {...RECHARTS_PERF}
              />
              <Line
                yAxisId="kw"
                type="monotone"
                dataKey="charging_demand_kw"
                stroke={COLORS.charging}
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={false}
                {...RECHARTS_PERF}
              />
              <Line
                yAxisId="pct"
                type="monotone"
                dataKey="soc_percent"
                stroke={COLORS.soc}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: COLORS.soc }}
                {...RECHARTS_PERF}
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full min-h-[280px] items-center justify-center text-sm text-slate-500">
            {isStreaming ? "Buffering forecast points…" : "No forecast points available"}
          </div>
        )}
      </div>
    </section>
  );
}

const ForecastChart = memo(ForecastChartInner);
ForecastChart.displayName = "ForecastChart";

export default ForecastChart;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
