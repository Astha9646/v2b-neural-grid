import { memo, useMemo } from "react";
import { useChartsPanelSlice } from "../hooks/useTelemetrySelectors";
import { LiveBadge, PanelSkeleton, TelemetryError } from "./telemetry/TelemetryStates";

const STAGGER_MS = [0, 80, 160, 240, 320];

const ACCENTS = {
  emerald: {
    border: "border-emerald-500/20 hover:border-emerald-400/40",
    glow: "hover:shadow-[0_0_28px_rgba(52,211,153,0.16)]",
    icon: "text-emerald-400 bg-emerald-500/10 ring-emerald-400/25",
    value: "text-emerald-50",
    bar: "from-emerald-500 to-emerald-300",
  },
  cyan: {
    border: "border-cyan-500/20 hover:border-cyan-400/40",
    glow: "hover:shadow-[0_0_28px_rgba(34,211,238,0.15)]",
    icon: "text-cyan-400 bg-cyan-500/10 ring-cyan-400/25",
    value: "text-cyan-50",
    bar: "from-cyan-500 to-cyan-300",
  },
  teal: {
    border: "border-teal-500/20 hover:border-teal-400/40",
    glow: "hover:shadow-[0_0_28px_rgba(45,212,191,0.14)]",
    icon: "text-teal-400 bg-teal-500/10 ring-teal-400/25",
    value: "text-teal-50",
    bar: "from-teal-500 to-teal-300",
  },
};

function SunIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CloudSunIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="9" cy="9" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M9 3v1M9 15v1M3 9H2M16 9h-1M5.5 5.5l-.7-.7M12.7 12.7l-.7-.7M5.5 12.5l-.7.7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M7 18h10a3 3 0 100-6 3.5 3.5 0 00-6.8-1.2A4 4 0 007 18z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LeafIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 20c4-6 8-10 14-12-2 6-6 10-12 12z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.1"
      />
    </svg>
  );
}

function PercentIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="17" cy="17" r="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M19 5L5 19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ForecastIcon({ className }) {
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

function StatusIndicator({ active, label, variant = "emerald" }) {
  const dot =
    variant === "cyan"
      ? "bg-cyan-400 shadow-[0_0_10px_#22d3ee]"
      : "bg-emerald-400 shadow-[0_0_10px_#34d399]";
  const border =
    variant === "cyan"
      ? "border-cyan-500/30 bg-cyan-500/10"
      : "border-emerald-500/30 bg-emerald-500/10";
  const text = variant === "cyan" ? "text-cyan-300" : "text-emerald-300";

  return (
    <div className={["flex items-center gap-2 rounded-lg border px-3 py-2", border].join(" ")}>
      <span className="relative flex h-2.5 w-2.5">
        {active ? (
          <span
            className={[
              "absolute inline-flex h-full w-full animate-ping rounded-full opacity-50",
              dot,
            ].join(" ")}
          />
        ) : null}
        <span className={["relative inline-flex h-2.5 w-2.5 rounded-full", dot].join(" ")} />
      </span>
      <span className={["text-xs font-semibold uppercase tracking-wider", text].join(" ")}>
        {label}
      </span>
    </div>
  );
}

function ProgressBar({ value, max = 100, accent = "emerald", label }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const a = ACCENTS[accent] ?? ACCENTS.emerald;

  return (
    <div className="w-full">
      {label ? (
        <div className="mb-1.5 flex justify-between text-[10px] uppercase tracking-wider text-slate-500">
          <span>{label}</span>
          <span className="font-mono tabular-nums text-slate-400">
            {typeof value === "number" && max !== 100
              ? `${value.toFixed(1)} / ${max} kW`
              : `${pct.toFixed(0)}%`}
          </span>
        </div>
      ) : null}
      <div className="h-2.5 overflow-hidden rounded-full bg-slate-800/80 ring-1 ring-white/5">
        <div
          className={[
            "h-full rounded-full bg-gradient-to-r transition-all duration-700 ease-out",
            a.bar,
            pct > 0 ? "shadow-[0_0_14px_rgba(52,211,153,0.35)]" : "",
          ].join(" ")}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={max}
        />
      </div>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, sub, accent = "emerald", delay = 0 }) {
  const a = ACCENTS[accent] ?? ACCENTS.emerald;

  return (
    <div
      className={[
        "group relative overflow-hidden rounded-xl border bg-white/[0.03] p-4 backdrop-blur-sm",
        "transition-all duration-300 hover:-translate-y-0.5 animate-fade-in-up opacity-0",
        a.border,
        a.glow,
      ].join(" ")}
      style={{ animationDelay: `${delay}ms`, animationFillMode: "forwards" }}
    >
      <div
        className="pointer-events-none absolute -right-4 -top-4 h-20 w-20 rounded-full bg-emerald-500/10 blur-2xl opacity-0 transition-opacity group-hover:opacity-100"
        aria-hidden
      />
      <div className="relative flex items-start gap-3">
        <span
          className={[
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1 transition-transform group-hover:scale-105",
            a.icon,
          ].join(" ")}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {label}
          </p>
          <p className={["mt-1 font-display text-xl font-bold tabular-nums sm:text-2xl", a.value].join(" ")}>
            {value}
          </p>
          {sub ? <p className="mt-0.5 text-xs text-slate-500">{sub}</p> : null}
        </div>
      </div>
    </div>
  );
}

function WeatherSection({ weather }) {
  const WeatherGraphic =
    weather.icon === "partly-cloudy" ? CloudSunIcon : SunIcon;

  return (
    <div
      className={[
        "relative overflow-hidden rounded-xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/10 via-transparent to-emerald-500/5 p-4 sm:p-5",
        "transition-all duration-300 hover:border-cyan-400/35 hover:shadow-[0_0_32px_rgba(34,211,238,0.12)]",
      ].join(" ")}
    >
      <div
        className="pointer-events-none absolute right-0 top-0 h-32 w-32 translate-x-8 -translate-y-8 rounded-full bg-amber-400/10 blur-3xl"
        aria-hidden
      />
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
        Weather condition
      </p>
      <div className="relative mt-3 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/10 ring-1 ring-amber-400/25 shadow-[0_0_24px_rgba(251,191,36,0.15)]">
            <WeatherGraphic className="h-9 w-9 text-amber-300" />
          </div>
          <div>
            <p className="font-display text-lg font-bold text-white">{weather.condition}</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums text-amber-200">
              {weather.tempC}°C
            </p>
          </div>
        </div>
        <ul className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:text-right">
          <li>
            <span className="text-slate-500">Irradiance</span>
            <p className="font-mono font-semibold text-cyan-200">{weather.irradiance} W/m²</p>
          </li>
          <li>
            <span className="text-slate-500">Humidity</span>
            <p className="font-mono font-semibold text-slate-300">{weather.humidity}%</p>
          </li>
          <li>
            <span className="text-slate-500">Wind</span>
            <p className="font-mono font-semibold text-slate-300">{weather.windKmh} km/h</p>
          </li>
          <li>
            <span className="text-slate-500">PV index</span>
            <p className="font-mono font-semibold text-emerald-300">0.68</p>
          </li>
        </ul>
      </div>
    </div>
  );
}

function ForecastRow({ item, maxKw }) {
  const barPct = maxKw > 0 ? (item.solarKw / maxKw) * 100 : 0;

  return (
    <li className="group flex items-center gap-3 rounded-lg border border-transparent px-2 py-2 transition-all hover:border-emerald-500/20 hover:bg-white/[0.02]">
      <span className="w-12 shrink-0 font-mono text-xs tabular-nums text-slate-500">
        {item.hour}
      </span>
      <div className="min-w-0 flex-1">
        <ProgressBar value={item.solarKw} max={maxKw} accent="emerald" />
      </div>
      <span className="w-14 shrink-0 text-right font-mono text-xs font-semibold tabular-nums text-emerald-300">
        {item.solarKw} kW
      </span>
      <span className="hidden w-12 shrink-0 text-right font-mono text-[10px] tabular-nums text-cyan-400/80 sm:block">
        {item.contributionPct}%
      </span>
    </li>
  );
}

/**
 * Renewable energy monitoring panel (demo data).
 *
 * @param {object} [props]
 * @param {typeof DEMO_DATA} [props.data]
 * @param {string} [props.className]
 */
function SolarPanelInner({ data: dataProp, className = "" }) {
  const { solar, loading, error, isLive, lastUpdated, refresh } = useChartsPanelSlice("solar");
  const data = useMemo(() => dataProp ?? solar, [dataProp, solar]);

  if (loading && !dataProp) {
    return <PanelSkeleton className={className} rows={4} />;
  }

  if (error && !dataProp && !solar) {
    return <TelemetryError message={error} onRetry={refresh} className={className} />;
  }

  if (!data) {
    return <PanelSkeleton className={className} rows={4} />;
  }

  return (
    <SolarPanelView data={data} className={className} isLive={isLive} lastUpdated={lastUpdated} />
  );
}

function SolarPanelView({ data, className, isLive, lastUpdated }) {
  const forecast = data?.forecast ?? [];
  const solarGenerationKw = data?.solarGenerationKw ?? 0;
  const solarCapacityKw = data?.solarCapacityKw || 120;

  const utilizationPct = useMemo(
    () => (solarGenerationKw / solarCapacityKw) * 100,
    [solarGenerationKw, solarCapacityKw],
  );

  const maxForecastKw = useMemo(() => {
    if (!forecast.length) return 1;
    return Math.max(...forecast.map((f) => f?.solarKw ?? 0), 1);
  }, [forecast]);

  const peakForecastHour = useMemo(() => {
    if (!forecast.length) return "—";
    const peak = forecast.reduce((a, b) =>
      (b?.solarKw ?? 0) > (a?.solarKw ?? 0) ? b : a,
    );
    return peak?.hour ?? "—";
  }, [forecast]);

  return (
    <section
      className={["relative", className].join(" ")}
      aria-labelledby="solar-panel-title"
    >
      <div
        className={[
          "relative overflow-hidden rounded-2xl border border-emerald-500/15",
          "bg-white/[0.02] p-4 backdrop-blur-md sm:p-6",
          "transition-shadow duration-300 hover:shadow-[0_0_48px_rgba(52,211,153,0.08)]",
        ].join(" ")}
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/50 to-cyan-400/30"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -left-16 top-1/3 h-48 w-48 rounded-full bg-emerald-500/10 blur-[90px]"
          aria-hidden
        />

        <header className="relative mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/10 ring-1 ring-emerald-400/30 shadow-[0_0_20px_rgba(52,211,153,0.2)]">
              <SunIcon className="h-6 w-6 text-emerald-400" />
            </div>
            <div>
              <p className="font-display text-[10px] font-semibold uppercase tracking-[0.28em] text-emerald-500/80">
                Renewables
              </p>
              <h2
                id="solar-panel-title"
                className="font-display text-xl font-bold text-white sm:text-2xl"
              >
                Solar &amp; Clean Energy
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                solar_generation_kw · renewable_ratio · carbon_savings_kg
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LiveBadge isLive={isLive} lastUpdated={lastUpdated} />
            <StatusIndicator active label="PV generating" variant="emerald" />
            <StatusIndicator active label="Grid sync OK" variant="cyan" />
          </div>
        </header>

        {/* Metric cards */}
        <div className="relative mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            icon={SunIcon}
            label="Solar generation"
            value={`${solarGenerationKw.toFixed(1)} kW`}
            sub={`${utilizationPct.toFixed(0)}% of ${solarCapacityKw} kW capacity`}
            accent="emerald"
            delay={STAGGER_MS[0]}
          />
          <MetricCard
            icon={PercentIcon}
            label="Renewable contribution"
            value={`${data?.renewableContributionPct ?? 0}%`}
            sub={`Grid mix ${data?.gridMixPct ?? 0}% · EV charging offset`}
            accent="cyan"
            delay={STAGGER_MS[1]}
          />
          <MetricCard
            icon={LeafIcon}
            label="Carbon savings"
            value={`${data?.carbonSavingsKg ?? 0} kg`}
            sub={`+${data?.carbonSavingsTodayKg ?? 0} kg today · CO₂ avoided`}
            accent="teal"
            delay={STAGGER_MS[2]}
          />
          <MetricCard
            icon={ForecastIcon}
            label="Energy forecast"
            value={`${forecast[0]?.solarKw ?? 0} kW`}
            sub={`Peak @ ${peakForecastHour}`}
            accent="emerald"
            delay={STAGGER_MS[3]}
          />
        </div>

        <div className="relative grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Progress bars */}
          <div
            className={[
              "rounded-xl border border-white/10 bg-white/[0.02] p-4 sm:p-5",
              "animate-fade-in-up opacity-0",
            ].join(" ")}
            style={{ animationDelay: "200ms", animationFillMode: "forwards" }}
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              Renewable mix
            </p>
            <div className="mt-4 space-y-5">
              <ProgressBar
                label="Solar output"
                value={data.solarGenerationKw}
                max={data.solarCapacityKw}
                accent="emerald"
              />
              <ProgressBar
                label="Renewable share of load"
                value={data.renewableContributionPct}
                max={100}
                accent="cyan"
              />
              <ProgressBar
                label="Grid dependency"
                value={data.gridMixPct}
                max={100}
                accent="teal"
              />
            </div>
            <p className="mt-4 text-[11px] text-slate-500">
              Target renewable utilization:{" "}
              <span className="font-semibold text-emerald-400">75%</span> by EOD
            </p>
          </div>

          {/* Weather */}
          <div
            className="animate-fade-in-up opacity-0"
            style={{ animationDelay: "280ms", animationFillMode: "forwards" }}
          >
            <WeatherSection weather={data.weather} />
          </div>
        </div>

        {/* Forecast timeline */}
        <div
          className={[
            "relative mt-6 rounded-xl border border-emerald-500/15 bg-slate-900/20 p-4 sm:p-5",
            "animate-fade-in-up opacity-0",
          ].join(" ")}
          style={{ animationDelay: "360ms", animationFillMode: "forwards" }}
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              Energy forecast · next 5 intervals
            </p>
            <span className="rounded-md border border-cyan-500/20 bg-cyan-500/5 px-2 py-0.5 text-[10px] text-cyan-300/90">
              Telemetry forecast
            </span>
          </div>
          <ul className="space-y-1">
            {forecast.map((item) => (
              <ForecastRow key={item.hour} item={item} maxKw={maxForecastKw} />
            ))}
          </ul>
        </div>

        <footer className="relative mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-4 text-[10px] text-slate-600">
          <span>V2B Neural Grid · State feature: solar index · Sample telemetry</span>
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live telemetry
          </span>
        </footer>
      </div>
    </section>
  );
}

const SolarPanel = memo(SolarPanelInner);
SolarPanel.displayName = "SolarPanel";

export default SolarPanel;
