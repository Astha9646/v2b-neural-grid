import { memo, useMemo } from "react";
import { useChartSeries } from "../hooks/useTelemetrySelectors";
import { computeYDomain, hasEnoughChartPoints, logChartDebug, RECHARTS_PERF } from "../utils/chartUtils";
import {
  ChartEmptyState,
  ChartSkeleton,
  LiveBadge,
  TelemetryError,
} from "./telemetry/TelemetryStates";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/** Series metadata: keys must match data object properties. */
const CHARGER_SERIES = [
  {
    key: "chargerA",
    name: "Charger A · L2",
    color: "#22d3ee",
    glow: "rgba(34, 211, 238, 0.5)",
  },
  {
    key: "chargerB",
    name: "Charger B · L2",
    color: "#34d399",
    glow: "rgba(52, 211, 153, 0.5)",
  },
  {
    key: "chargerC",
    name: "Charger C · DC Fast",
    color: "#67e8f9",
    glow: "rgba(103, 232, 249, 0.45)",
  },
  {
    key: "chargerD",
    name: "Charger D · V2B",
    color: "#a78bfa",
    glow: "rgba(167, 139, 250, 0.45)",
  },
];

const CHART_HEIGHT = 300;

const CHART_THEME = {
  grid: "rgba(148, 163, 184, 0.08)",
  axis: "#64748b",
  tooltipBg: "rgba(15, 23, 42, 0.94)",
  tooltipBorder: "rgba(34, 211, 238, 0.35)",
};

function formatKw(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)} kW`;
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  const total = payload.reduce((sum, entry) => sum + (Number(entry.value) || 0), 0);

  return (
    <div
      className="min-w-[180px] rounded-xl border px-3.5 py-3 shadow-neon-cyan backdrop-blur-md"
      style={{
        backgroundColor: CHART_THEME.tooltipBg,
        borderColor: CHART_THEME.tooltipBorder,
      }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-cyan-500/80">
        {label}
      </p>
      <ul className="mt-2 space-y-1.5">
        {payload.map((entry) => (
          <li
            key={entry.dataKey}
            className="flex items-center justify-between gap-4 text-xs"
          >
            <span className="flex items-center gap-2 text-slate-400">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: entry.color, boxShadow: `0 0 6px ${entry.color}` }}
              />
              {entry.name}
            </span>
            <span className="font-semibold tabular-nums text-slate-100">
              {formatKw(entry.value)}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-2 border-t border-white/10 pt-2">
        <p className="flex justify-between text-[11px]">
          <span className="text-slate-500">Net fleet</span>
          <span className="font-semibold tabular-nums text-cyan-200">
            {formatKw(total)}
          </span>
        </p>
      </div>
    </div>
  );
}

function ChartLegend({ payload }) {
  if (!payload?.length) return null;

  return (
    <ul className="flex flex-wrap justify-center gap-x-4 gap-y-2 px-2 pt-2">
      {payload.map((entry) => (
        <li
          key={entry.value}
          className="flex items-center gap-2 rounded-lg border border-white/5 bg-slate-900/40 px-2.5 py-1 text-[11px] text-slate-400 transition-colors hover:border-cyan-500/20 hover:text-slate-200"
        >
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{
              backgroundColor: entry.color,
              boxShadow: `0 0 8px ${entry.color}`,
            }}
          />
          <span>{entry.value}</span>
        </li>
      ))}
    </ul>
  );
}

function ChargingIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.12"
      />
    </svg>
  );
}

/**
 * Multi-charger EV charging power analytics chart (demo data).
 *
 * @param {object} [props]
 * @param {Array<Record<string, string | number>>} [props.data]
 * @param {typeof CHARGER_SERIES} [props.series]
 * @param {string} [props.title]
 * @param {string} [props.subtitle]
 * @param {string} [props.className]
 */
function ChargingChartInner({
  series = CHARGER_SERIES,
  title = "Charging Power Analytics",
  subtitle = "Per-station charging_power_kw · charger utilization",
  className = "",
}) {
  const { charts = {}, loading, error, isLive, lastUpdated, refresh, summary } = useChartSeries();
  const chargingSeries = charts?.charging ?? [];
  const chartData = useMemo(() => {
    logChartDebug("ChargingChart", chargingSeries);
    return chargingSeries;
  }, [chargingSeries]);

  const yDomain = useMemo(() => {
    const values = [];
    for (const row of chartData) {
      for (const s of series) {
        const v = Number(row[s.key]);
        if (Number.isFinite(v)) values.push(v);
      }
    }
    return computeYDomain(values, { floor: 0, minSpan: 5 });
  }, [chartData, series]);

  const peakTotal = useMemo(() => {
    let best = { time: "—", total: 0 };
    for (const row of chartData) {
      const total = series.reduce(
        (sum, s) => sum + Math.max(0, Number(row[s.key]) || 0),
        0,
      );
      if (total > best.total) best = { time: row.time, total: Math.round(total) };
    }
    return best;
  }, [chartData, series]);

  if (loading) {
    return <ChartSkeleton className={className} label="Loading charging telemetry…" />;
  }

  if (error && !chartData.length) {
    return <TelemetryError message={error} onRetry={refresh} className={className} />;
  }

  if (!hasEnoughChartPoints(chartData, 2)) {
    return (
      <section className={["panel-shell min-w-0", className].join(" ")}>
        <ChartEmptyState message={isLive ? "Buffering charger power samples…" : "No charging telemetry yet"} />
      </section>
    );
  }

  return (
    <section
      className={[
        "group relative min-w-0 overflow-hidden rounded-2xl border border-cyan-500/15",
        "bg-white/[0.03] p-4 backdrop-blur-md transition-all duration-300 sm:p-5",
        "hover:border-cyan-400/25 hover:shadow-[0_0_24px_rgba(34,211,238,0.08)]",
        className,
      ].join(" ")}
      aria-label={title}
    >
      <div
        className="pointer-events-none absolute -right-16 top-0 h-48 w-48 rounded-full bg-emerald-500/10 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -left-12 bottom-0 h-40 w-40 rounded-full bg-cyan-500/10 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/40 to-emerald-400/30"
        aria-hidden
      />

      <header className="relative mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500/15 to-emerald-500/10 ring-1 ring-cyan-400/25">
            <ChargingIcon className="h-5 w-5 text-cyan-400" />
          </div>
          <div className="min-w-0">
            <h3 className="font-display text-base font-bold text-white sm:text-lg">
              {title}
            </h3>
            <p className="mt-0.5 text-xs text-slate-400 sm:text-sm">{subtitle}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-1.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <LiveBadge isLive={isLive} lastUpdated={lastUpdated} />
        </div>
      </header>

      <div className="relative mb-3 flex flex-wrap gap-2 text-xs">
        <span className="rounded-md border border-cyan-500/20 bg-cyan-500/5 px-2 py-1 text-cyan-300/90">
          Peak charge:{" "}
          <strong className="tabular-nums text-cyan-100">{peakTotal.total} kW</strong>
          <span className="text-slate-500"> @ {peakTotal.time}</span>
        </span>
        {summary ? (
          <span className="rounded-md border border-violet-500/20 bg-violet-500/5 px-2 py-1 text-violet-300/90">
            Utilization {((Number(summary?.chargerUtilization) || 0) * 100).toFixed(0)}%
          </span>
        ) : null}
        <span className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-2 py-1 text-emerald-300/90">
          {series.length} charger streams
        </span>
        <span className="rounded-md border border-white/5 bg-slate-900/40 px-2 py-1 text-slate-400">
          + charge · − V2B
        </span>
      </div>

      <div className="relative w-full min-w-0 h-[300px] overflow-hidden">
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <LineChart
            data={chartData}
            margin={{ top: 8, right: 12, left: -4, bottom: 0 }}
          >
            <defs>
              {series.map((s) => (
                <filter
                  key={`glow-${s.key}`}
                  id={`chargingGlow-${s.key}`}
                  x="-30%"
                  y="-30%"
                  width="160%"
                  height="160%"
                >
                  <feGaussianBlur stdDeviation="2" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              ))}
            </defs>

            <CartesianGrid
              strokeDasharray="4 8"
              stroke={CHART_THEME.grid}
              vertical={false}
            />

            <XAxis
              dataKey="time"
              axisLine={false}
              tickLine={false}
              tick={{ fill: CHART_THEME.axis, fontSize: 11 }}
              dy={8}
            />

            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: CHART_THEME.axis, fontSize: 11 }}
              domain={yDomain}
              width={40}
              tickFormatter={(v) => `${v}`}
              label={{
                value: "kW",
                angle: -90,
                position: "insideLeft",
                fill: "#64748b",
                fontSize: 10,
                dx: 4,
              }}
            />

            <Tooltip
              content={<ChartTooltip />}
              animationDuration={0}
              cursor={{
                stroke: "#22d3ee",
                strokeWidth: 1,
                strokeDasharray: "4 4",
                strokeOpacity: 0.35,
              }}
            />

            <Legend content={<ChartLegend />} verticalAlign="bottom" height={48} />

            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={s.color}
                strokeWidth={2.5}
                filter={`url(#chargingGlow-${s.key})`}
                dot={false}
                activeDot={{
                  r: 5,
                  fill: s.color,
                  stroke: "#0f172a",
                  strokeWidth: 2,
                  style: { filter: `drop-shadow(0 0 8px ${s.glow})` },
                }}
                {...RECHARTS_PERF}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="relative mt-3 text-center text-[10px] text-slate-600">
        Heterogeneous charger power · V2B Neural Grid · Sample data only
      </p>
    </section>
  );
}

const ChargingChart = memo(ChargingChartInner);
ChargingChart.displayName = "ChargingChart";

export default ChargingChart;
