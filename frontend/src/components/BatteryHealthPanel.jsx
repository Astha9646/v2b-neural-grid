import { memo, useMemo } from "react";
import { useChartsPanelSlice } from "../hooks/useTelemetrySelectors";
import { LiveBadge, PanelSkeleton, TelemetryError } from "./telemetry/TelemetryStates";

const STAGGER_MS = [0, 70, 140, 210, 280];

const ACCENTS = {
  cyan: {
    border: "border-cyan-500/15 hover:border-cyan-400/30",
    glow: "hover:shadow-[0_0_16px_rgba(34,211,238,0.08)]",
    icon: "text-cyan-400 bg-cyan-500/10 ring-cyan-400/25",
    value: "text-cyan-50",
    bar: "from-cyan-500 to-cyan-300",
  },
  amber: {
    border: "border-amber-500/20 hover:border-amber-400/40",
    glow: "hover:shadow-[0_0_16px_rgba(251,191,36,0.08)]",
    icon: "text-amber-400 bg-amber-500/10 ring-amber-400/25",
    value: "text-amber-50",
    bar: "from-amber-500 to-amber-300",
  },
  emerald: {
    border: "border-emerald-500/20 hover:border-emerald-400/40",
    glow: "hover:shadow-[0_0_16px_rgba(52,211,153,0.08)]",
    icon: "text-emerald-400 bg-emerald-500/10 ring-emerald-400/25",
    value: "text-emerald-50",
    bar: "from-emerald-500 to-emerald-300",
  },
  rose: {
    border: "border-rose-500/20 hover:border-rose-400/40",
    glow: "hover:shadow-[0_0_28px_rgba(244,63,94,0.14)]",
    icon: "text-rose-400 bg-rose-500/10 ring-rose-400/25",
    value: "text-rose-50",
    bar: "from-rose-500 to-rose-400",
  },
};

const WARNING_STYLES = {
  critical: {
    border: "border-rose-500/30 bg-rose-500/10",
    text: "text-rose-300",
    dot: "bg-rose-400 glow-dot-amber",
  },
  warning: {
    border: "border-amber-500/30 bg-amber-500/10",
    text: "text-amber-300",
    dot: "bg-amber-400 glow-dot-amber",
  },
  info: {
    border: "border-cyan-500/25 bg-cyan-500/5",
    text: "text-cyan-300",
    dot: "bg-cyan-400 glow-dot-cyan",
  },
};

function healthBarColor(pct) {
  if (pct >= 90) return ACCENTS.emerald.bar;
  if (pct >= 75) return ACCENTS.cyan.bar;
  if (pct >= 60) return ACCENTS.amber.bar;
  return ACCENTS.rose.bar;
}

function stressColor(score) {
  if (score >= 70) return ACCENTS.rose;
  if (score >= 50) return ACCENTS.amber;
  return ACCENTS.cyan;
}

function BatteryIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="7" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M18 10h2a1 1 0 011 1v2a1 1 0 01-1 1h-2" stroke="currentColor" strokeWidth="1.5" />
      <rect x="6" y="9" width="7" height="6" rx="1" fill="currentColor" fillOpacity="0.25" />
    </svg>
  );
}

function DegradeIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 19V5M10 19V9M16 19V12M22 19V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ThermoIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M14 4v8.5a4 4 0 11-4 0V4a2 2 0 014 0z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 16v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function StatusIndicator({ label, variant = "cyan", pulse = true }) {
  const dot =
    variant === "amber"
      ? "bg-amber-400 glow-dot-amber"
      : variant === "emerald"
        ? "bg-emerald-400 glow-dot-emerald"
        : "bg-cyan-400 glow-dot-cyan";
  const border =
    variant === "amber"
      ? "border-amber-500/30 bg-amber-500/10"
      : variant === "emerald"
        ? "border-emerald-500/30 bg-emerald-500/10"
        : "border-cyan-500/30 bg-cyan-500/10";
  const text =
    variant === "amber" ? "text-amber-300" : variant === "emerald" ? "text-emerald-300" : "text-cyan-300";

  return (
    <div className={["flex items-center gap-2 rounded-lg border px-3 py-2", border].join(" ")}>
      <span className="relative flex h-2.5 w-2.5">
        {pulse ? (
          <span className={["absolute inline-flex h-full w-full animate-ping rounded-full opacity-50", dot].join(" ")} />
        ) : null}
        <span className={["relative inline-flex h-2.5 w-2.5 rounded-full", dot].join(" ")} />
      </span>
      <span className={["text-xs font-semibold uppercase tracking-wider", text].join(" ")}>{label}</span>
    </div>
  );
}

function HealthProgressBar({ value, label, sublabel, accentBar }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="w-full">
      <div className="mb-1.5 flex justify-between gap-2 text-[10px] uppercase tracking-wider text-slate-500">
        <span>{label}</span>
        <span className="font-mono tabular-nums text-slate-400">{sublabel ?? `${pct}%`}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-slate-800/80 ring-1 ring-white/5">
        <div
          className={[
            "h-full rounded-full bg-gradient-to-r transition-all duration-700 ease-out",
            accentBar ?? healthBarColor(pct),
            pct > 0 ? "shadow-[0_0_12px_rgba(251,191,36,0.25)]" : "",
          ].join(" ")}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, sub, accent = "cyan", delay = 0 }) {
  const a = ACCENTS[accent] ?? ACCENTS.cyan;
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
      <div className="relative flex items-start gap-3">
        <span className={["flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1 group-hover:scale-105 transition-transform", a.icon].join(" ")}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
          <p className={["mt-1 font-display text-lg font-bold tabular-nums sm:text-xl", a.value].join(" ")}>{value}</p>
          {sub ? <p className="mt-0.5 text-xs text-slate-500">{sub}</p> : null}
        </div>
      </div>
    </div>
  );
}

function WarningBanner({ warning }) {
  const s = WARNING_STYLES[warning.level] ?? WARNING_STYLES.info;
  return (
    <li
      className={[
        "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition-all hover:brightness-110",
        s.border,
      ].join(" ")}
    >
      <span className={["mt-1.5 h-2 w-2 shrink-0 rounded-full", s.dot].join(" ")} />
      <p className={s.text}>{warning.message}</p>
    </li>
  );
}

function FleetHealthRow({ row }) {
  const stress = stressColor(row.stress);
  const tempWarn = row.temp >= 40;

  return (
    <li className="group flex flex-col gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-3 transition-all hover:border-amber-500/20 hover:bg-white/[0.03] sm:flex-row sm:items-center sm:gap-4">
      <span className="w-16 shrink-0 font-mono text-xs font-bold text-slate-300">{row.evId}</span>
      <div className="min-w-0 flex-1">
        <HealthProgressBar value={row.health} label="Health" sublabel={`${row.health}%`} />
      </div>
      <div className="flex shrink-0 flex-wrap gap-2 text-[10px]">
        <span className={["rounded-md px-2 py-1 ring-1", stress.border, stress.icon].join(" ")}>
          Stress {row.stress}
        </span>
        <span
          className={[
            "rounded-md px-2 py-1 ring-1",
            tempWarn
              ? "bg-amber-500/10 text-amber-300 ring-amber-500/30"
              : "bg-cyan-500/10 text-cyan-300 ring-cyan-500/30",
          ].join(" ")}
        >
          {row.temp}°C
        </span>
      </div>
    </li>
  );
}

/**
 * Battery health analytics panel for V2B fleet (demo data).
 *
 * @param {object} [props]
 * @param {typeof DEMO_DATA} [props.data]
 * @param {string} [props.className]
 */
function BatteryHealthPanelInner({ data: dataProp, className = "" }) {
  const { battery, loading, error, isLive, lastUpdated, refresh } = useChartsPanelSlice("battery");
  const data = useMemo(() => dataProp ?? battery, [dataProp, battery]);

  if (loading && !dataProp) {
    return <PanelSkeleton className={className} rows={5} />;
  }

  if (error && !dataProp && !battery) {
    return <TelemetryError message={error} onRetry={refresh} className={className} />;
  }

  if (!data) {
    return <PanelSkeleton className={className} rows={5} />;
  }

  return (
    <BatteryHealthPanelView
      data={data}
      className={className}
      isLive={isLive}
      lastUpdated={lastUpdated}
    />
  );
}

function BatteryHealthPanelView({ data, className, isLive, lastUpdated }) {
  const thermal = data?.thermal ?? { status: "normal", cellTempC: 0, maxSafeC: 45 };
  const warnings = data?.warnings ?? [];
  const fleetRows = data?.fleet ?? [];
  const chargingStress = data?.chargingStress ?? { level: "low" };
  const predictedLifespan = data?.predictedLifespan ?? { yearsRemaining: 0 };

  const thermalVariant =
    thermal.status === "critical"
      ? "rose"
      : thermal.status === "elevated" || thermal.status === "warm"
        ? "amber"
        : "cyan";

  const hasWarnings = warnings.some((w) => w?.level === "warning" || w?.level === "critical");

  return (
    <section className={["relative", className].join(" ")} aria-labelledby="battery-health-title">
      <div className="panel-shell border-amber-500/12">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/45 to-cyan-400/30"
          aria-hidden
        />
        <header className="relative mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 ring-1 ring-amber-400/20">
              <BatteryIcon className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <p className="section-eyebrow text-amber-500/70">Battery analytics</p>
              <h2 id="battery-health-title" className="section-heading">
                EV Battery Health
              </h2>
              <p className="section-subheading">Fleet SOH, degradation, and thermal status</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LiveBadge isLive={isLive} lastUpdated={lastUpdated} />
            <StatusIndicator
              label={hasWarnings ? "Alerts active" : "Fleet healthy"}
              variant={hasWarnings ? "amber" : "emerald"}
            />
          </div>
        </header>

        <div className="relative mb-8 grid grid-cols-1 gap-5 sm:grid-cols-3">
          <MetricCard
            icon={BatteryIcon}
            label="Battery health"
            value={`${data?.healthPct ?? 0}%`}
            sub="Fleet-weighted SOH"
            accent="emerald"
            delay={STAGGER_MS[0]}
          />
          <MetricCard
            icon={DegradeIcon}
            label="Degradation"
            value={`${data?.degradationPctPerYear ?? 0}%/yr`}
            sub={`Status: ${data?.degradationStatus ?? "unknown"}`}
            accent="amber"
            delay={STAGGER_MS[1]}
          />
          <MetricCard
            icon={ThermoIcon}
            label="Thermal"
            value={`${thermal.cellTempC ?? 0}°C`}
            sub={`${thermal.status ?? "normal"} · max ${thermal.maxSafeC ?? 45}°C`}
            accent={thermalVariant === "amber" ? "amber" : "cyan"}
            delay={STAGGER_MS[2]}
          />
        </div>

        <div className="relative space-y-6">
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Fleet snapshot
              </p>
              <p className="text-xs text-slate-500">
                Stress {chargingStress.level ?? "—"} · {predictedLifespan.yearsRemaining ?? "—"} yr lifespan
              </p>
            </div>
            <ul className="space-y-3">
              {fleetRows.slice(0, 3).map((row) => (
                <FleetHealthRow key={row.evId} row={row} />
              ))}
            </ul>
          </div>

          {warnings[0] ? (
            <div className="rounded-xl border border-amber-500/15 bg-amber-500/5 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-400/80">
                Latest alert
              </p>
              <ul className="mt-2">
                <WarningBanner warning={warnings[0]} />
              </ul>
            </div>
          ) : null}
        </div>

        <footer className="relative mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-4 text-[10px] text-slate-600">
          <span>V2B Neural Grid · live battery telemetry</span>
          <span className="flex items-center gap-2">
            <span className={["h-1.5 w-1.5 rounded-full", hasWarnings ? "animate-pulse bg-amber-400" : "bg-emerald-400"].join(" ")} />
            Sample BMS feed
          </span>
        </footer>
      </div>
    </section>
  );
}

const BatteryHealthPanel = memo(BatteryHealthPanelInner);
BatteryHealthPanel.displayName = "BatteryHealthPanel";

export default BatteryHealthPanel;
