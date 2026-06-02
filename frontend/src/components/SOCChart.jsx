import { memo, useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useChartSeries } from "../hooks/useTelemetrySelectors";
import { hasEnoughChartPoints, logChartDebug, RECHARTS_PERF } from "../utils/chartUtils";
import {
  ChartEmptyState,
  ChartSkeleton,
  LiveBadge,
  TelemetryError,
} from "./telemetry/TelemetryStates";

const CHART_HEIGHT = 300;
const TARGET_SOC = 90;
const MIN_SOC = 10;

const CHART_COLORS = {
  stroke: "#22d3ee",
  strokeGlow: "rgba(34, 211, 238, 0.55)",
  grid: "rgba(148, 163, 184, 0.08)",
  axis: "#64748b",
  tooltipBg: "rgba(15, 23, 42, 0.94)",
  tooltipBorder: "rgba(34, 211, 238, 0.4)",
  target: "#34d399",
};

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const soc = Number(payload[0]?.value ?? 0);
  const status =
    soc >= TARGET_SOC ? "Target reached" : soc <= MIN_SOC + 5 ? "Low SOC" : "Charging";
  const statusColor =
    soc >= TARGET_SOC ? "text-emerald-400" : soc <= MIN_SOC + 5 ? "text-rose-400" : "text-cyan-400";

  return (
    <div
      className="rounded-xl border px-3.5 py-2.5 backdrop-blur-md"
      style={{
        backgroundColor: CHART_COLORS.tooltipBg,
        borderColor: CHART_COLORS.tooltipBorder,
      }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-cyan-500/80">{label}</p>
      <p className="mt-1 font-display text-xl font-bold tabular-nums text-cyan-50">
        {soc.toFixed(1)}
        <span className="ml-0.5 text-base font-medium text-slate-400">%</span>
      </p>
      <p className={`mt-1 text-[11px] font-medium ${statusColor}`}>{status}</p>
    </div>
  );
}

function BatteryIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="7" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M18 10h2a1 1 0 011 1v2a1 1 0 01-1 1h-2" stroke="currentColor" strokeWidth="1.5" />
      <rect x="6" y="9" width="6" height="6" rx="1" fill="currentColor" fillOpacity="0.35" />
    </svg>
  );
}

function SOCChartInner({
  title = "Battery SOC Tracking",
  subtitle = "Fleet state of charge · soc_percent telemetry",
  targetSoc = TARGET_SOC,
  className = "",
}) {
  const { charts, loading, error, isLive, lastUpdated, refresh } = useChartSeries();
  const chartData = useMemo(() => {
    const data = charts?.soc ?? [];
    logChartDebug("SOCChart", data);
    return data;
  }, [charts?.soc]);

  const latest = chartData[chartData.length - 1];
  const peak = useMemo(() => {
    if (!chartData.length) return { time: "—", soc: 0 };
    return chartData.reduce((best, row) => (row.soc > best.soc ? row : best), chartData[0]);
  }, [chartData]);

  const avgSoc = useMemo(() => {
    if (!chartData.length) return 0;
    return (chartData.reduce((acc, row) => acc + row.soc, 0) / chartData.length).toFixed(1);
  }, [chartData]);

  if (loading) {
    return <ChartSkeleton className={className} label="Loading SOC telemetry…" />;
  }

  if (error && !chartData.length) {
    return <TelemetryError message={error} onRetry={refresh} className={className} />;
  }

  if (!hasEnoughChartPoints(chartData, 2)) {
    return (
      <section className={["panel-shell min-w-0", className].join(" ")}>
        <ChartEmptyState message={isLive ? "Buffering SOC samples…" : "No SOC telemetry yet"} />
      </section>
    );
  }

  return (
    <section
      className={[
        "group relative min-w-0 overflow-hidden rounded-2xl border border-cyan-500/15",
        "bg-white/[0.03] p-4 backdrop-blur-md transition-all duration-300 sm:p-5",
        className,
      ].join(" ")}
      aria-label={title}
    >
      <header className="relative mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10 ring-1 ring-cyan-400/20">
            <BatteryIcon className="h-5 w-5 text-cyan-400" />
          </div>
          <div className="min-w-0">
            <h3 className="font-display text-base font-bold text-white sm:text-lg">{title}</h3>
            <p className="mt-0.5 text-xs text-slate-400 sm:text-sm">{subtitle}</p>
          </div>
        </div>
        <LiveBadge isLive={isLive} lastUpdated={lastUpdated} />
      </header>

      <div className="relative mb-3 flex flex-wrap gap-2 text-xs">
        <span className="rounded-md border border-cyan-500/20 bg-cyan-500/5 px-2 py-1 text-cyan-300/90">
          Current: <strong className="tabular-nums text-cyan-100">{latest?.soc ?? "—"}%</strong>
        </span>
        <span className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-2 py-1 text-emerald-300/90">
          Peak: <strong className="tabular-nums text-emerald-100">{peak.soc}%</strong>
          <span className="text-slate-500"> @ {peak.time}</span>
        </span>
        <span className="rounded-md border border-white/5 bg-slate-900/40 px-2 py-1 text-slate-400">
          Avg {avgSoc}%
        </span>
      </div>

      <div className="relative w-full min-w-0 h-[300px] overflow-hidden">
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <LineChart data={chartData} margin={{ top: 12, right: 12, left: -4, bottom: 0 }}>
            <defs>
              <linearGradient id="socLineGradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#0891b2" stopOpacity="0.95" />
                <stop offset="50%" stopColor="#22d3ee" stopOpacity="1" />
                <stop offset="100%" stopColor="#67e8f9" stopOpacity="0.9" />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="4 8" stroke={CHART_COLORS.grid} vertical={false} />
            <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fill: CHART_COLORS.axis, fontSize: 11 }} />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: CHART_COLORS.axis, fontSize: 11 }}
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
            />
            <ReferenceLine
              y={targetSoc}
              stroke={CHART_COLORS.target}
              strokeDasharray="6 6"
              strokeOpacity={0.55}
            />
            <Tooltip content={<ChartTooltip />} />
            <Line
              type="monotone"
              dataKey="soc"
              stroke="url(#socLineGradient)"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 6, fill: CHART_COLORS.stroke }}
              {...RECHARTS_PERF}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

const SOCChart = memo(SOCChartInner);
SOCChart.displayName = "SOCChart";

export default SOCChart;
