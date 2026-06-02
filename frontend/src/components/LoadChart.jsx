import { memo, useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useChartSeries } from "../hooks/useTelemetrySelectors";
import { computeYDomain, hasEnoughChartPoints, logChartDebug, RECHARTS_PERF } from "../utils/chartUtils";
import {
  ChartEmptyState,
  ChartSkeleton,
  StreamBadge,
  TelemetryError,
} from "./telemetry/TelemetryStates";

const CHART_HEIGHT = 300;

const CHART_COLORS = {
  stroke: "#22d3ee",
  peak: "#34d399",
  grid: "rgba(148, 163, 184, 0.08)",
  axis: "#64748b",
  tooltipBg: "rgba(15, 23, 42, 0.92)",
  tooltipBorder: "rgba(34, 211, 238, 0.35)",
};

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const load = payload.find((p) => p.dataKey === "load")?.value ?? 0;
  const peak = payload.find((p) => p.dataKey === "peak")?.value ?? 0;

  return (
    <div
      className="rounded-xl border px-3 py-2 backdrop-blur-md"
      style={{
        backgroundColor: CHART_COLORS.tooltipBg,
        borderColor: CHART_COLORS.tooltipBorder,
      }}
    >
      <p className="text-xs text-cyan-300">{label}</p>
      <p className="mt-1 text-lg font-bold text-white">{Number(load).toFixed(1)} kW load</p>
      <p className="text-xs text-emerald-400">Peak window {Number(peak).toFixed(1)} kW</p>
    </div>
  );
}

function LoadIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 19V5M10 19V9M16 19V12M22 19V7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LoadChartInner({
  title = "Grid Load Monitoring",
  subtitle = "Real-time building energy demand from telemetry",
  className = "",
}) {
  const {
    charts,
    loading,
    error,
    isLive,
    isStreaming,
    streamStatus,
    lastUpdated,
    refresh,
    summary,
  } = useChartSeries();

  const chartData = useMemo(() => {
    const data = charts?.load ?? [];
    logChartDebug("LoadChart", data);
    return data;
  }, [charts?.load]);

  const yDomain = useMemo(() => {
    const values = chartData.flatMap((d) => [d?.load, d?.peak].filter(Number.isFinite));
    return computeYDomain(values, { floor: 0, minSpan: 8 });
  }, [chartData]);

  const peakPoint = useMemo(() => {
    if (!chartData.length) return { time: "—", load: 0 };
    return chartData.reduce(
      (best, row) => ((row?.load ?? 0) > (best?.load ?? 0) ? row : best),
      chartData[0],
    );
  }, [chartData]);

  if (loading) {
    return <ChartSkeleton className={className} label="Loading grid telemetry…" />;
  }

  if (error && !chartData.length) {
    return <TelemetryError message={error} onRetry={refresh} className={className} />;
  }

  if (!hasEnoughChartPoints(chartData, 2)) {
    return (
      <section className={["panel-shell min-w-0", className].join(" ")}>
        <ChartEmptyState message={isStreaming ? "Buffering grid load samples…" : "No grid load telemetry yet"} />
      </section>
    );
  }

  return (
    <section
      className={[
        "relative min-w-0 overflow-hidden rounded-2xl border border-cyan-500/15",
        "bg-slate-950/70 p-5 backdrop-blur-md",
        className,
      ].join(" ")}
    >
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10">
            <LoadIcon className="h-5 w-5 text-cyan-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">{title}</h3>
            <p className="text-sm text-slate-400">{subtitle}</p>
          </div>
        </div>
        <StreamBadge
          isStreaming={isStreaming}
          streamStatus={streamStatus}
          lastUpdated={lastUpdated}
        />
      </header>

      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <div className="rounded-lg border border-cyan-500/10 bg-cyan-500/5 px-3 py-1 text-cyan-300">
          Peak interval:
          <span className="ml-1 font-bold text-cyan-100">{peakPoint.load} kW</span>
        </div>
        {summary ? (
          <div className="rounded-lg border border-emerald-500/15 bg-emerald-500/5 px-3 py-1 text-emerald-300">
            Site peak:
            <span className="ml-1 font-bold">{summary.peakDemandKw} kW</span>
          </div>
        ) : null}
        <div className="rounded-lg border border-white/5 bg-slate-900/40 px-3 py-1 text-slate-400">
          {chartData.length} hourly samples
        </div>
      </div>

      <div className="w-full min-w-0 h-[300px] overflow-hidden">
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <LineChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="4 8" stroke={CHART_COLORS.grid} vertical={false} />
            <XAxis
              dataKey="time"
              axisLine={false}
              tickLine={false}
              tick={{ fill: CHART_COLORS.axis, fontSize: 11 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: CHART_COLORS.axis, fontSize: 11 }}
              domain={yDomain}
            />
            <Tooltip content={<ChartTooltip />} />
            <Line
              type="monotone"
              dataKey="peak"
              stroke={CHART_COLORS.peak}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              opacity={0.6}
              {...RECHARTS_PERF}
            />
            <Line
              type="monotone"
              dataKey="load"
              stroke={CHART_COLORS.stroke}
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 5, fill: CHART_COLORS.stroke }}
              {...RECHARTS_PERF}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

const LoadChart = memo(LoadChartInner);
LoadChart.displayName = "LoadChart";

export default LoadChart;
