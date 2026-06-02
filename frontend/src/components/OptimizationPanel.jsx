import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useOpsPanelSlice } from "../hooks/useTelemetrySelectors";
import { LiveBadge, PanelSkeleton, TelemetryError } from "./telemetry/TelemetryStates";

// ---------------------------------------------------------------------------
// Demo RL optimization snapshot
// ---------------------------------------------------------------------------

const EMPTY_METRICS = {
  energySavingsUsd: 0,
  energySavingsPct: 0,
  peakReductionKw: 0,
  peakReductionPct: 0,
  predictedReward: 0,
  episodesSimulated: 0,
};

const OPTIMIZATION_PHASES = [
  "Initializing DDPG actor…",
  "Loading 23-dim state vector…",
  "Running action masks (Algorithm 1)…",
  "Evaluating reward components r₁–r₃…",
  "Computing fleet setpoints…",
  "Optimization complete",
];

const ACCENT_CARD = {
  cyan: {
    border: "border-cyan-500/20 hover:border-cyan-400/40",
    glow: "hover:shadow-[0_0_28px_rgba(34,211,238,0.15)]",
    icon: "text-cyan-400 bg-cyan-500/10 ring-cyan-400/25",
    value: "text-cyan-100",
  },
  emerald: {
    border: "border-emerald-500/20 hover:border-emerald-400/40",
    glow: "hover:shadow-[0_0_28px_rgba(52,211,153,0.14)]",
    icon: "text-emerald-400 bg-emerald-500/10 ring-emerald-400/25",
    value: "text-emerald-100",
  },
  amber: {
    border: "border-amber-500/20 hover:border-amber-400/40",
    glow: "hover:shadow-[0_0_28px_rgba(251,191,36,0.12)]",
    icon: "text-amber-400 bg-amber-500/10 ring-amber-400/25",
    value: "text-amber-100",
  },
  violet: {
    border: "border-violet-500/20 hover:border-violet-400/40",
    glow: "hover:shadow-[0_0_28px_rgba(167,139,250,0.12)]",
    icon: "text-violet-400 bg-violet-500/10 ring-violet-400/25",
    value: "text-violet-100",
  },
};

function CpuIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BoltIcon({ className }) {
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

function SavingsIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PeakIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 17l6-6 4 4 8-10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Spinner({ className = "" }) {
  return (
    <span
      className={[
        "inline-block h-4 w-4 animate-spin rounded-full border-2 border-cyan-950/30 border-t-cyan-300",
        className,
      ].join(" ")}
      aria-hidden
    />
  );
}

function MetricActionCard({ icon: Icon, label, value, sub, accent = "cyan" }) {
  const a = ACCENT_CARD[accent] ?? ACCENT_CARD.cyan;
  return (
    <div
      className={[
        "group relative overflow-hidden rounded-xl border bg-white/[0.03] p-4 backdrop-blur-sm",
        "transition-all duration-300 hover:-translate-y-0.5",
        a.border,
        a.glow,
      ].join(" ")}
    >
      <div
        className="pointer-events-none absolute inset-0 rounded-xl opacity-0 ring-1 ring-inset ring-cyan-400/0 transition-all group-hover:opacity-100 group-hover:ring-cyan-400/20"
        aria-hidden
      />
      <div className="relative flex items-start gap-3">
        <span
          className={[
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1",
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

function LiveIndicator({ active, label }) {
  return (
    <div
      className={[
        "flex items-center gap-2 rounded-lg border px-3 py-2",
        active
          ? "border-cyan-500/30 bg-cyan-500/10"
          : "border-white/10 bg-slate-900/40",
      ].join(" ")}
    >
      <span className="relative flex h-2.5 w-2.5">
        {active ? (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-50" />
        ) : null}
        <span
          className={[
            "relative inline-flex h-2.5 w-2.5 rounded-full",
            active ? "bg-cyan-400 shadow-[0_0_10px_#22d3ee]" : "bg-slate-600",
          ].join(" ")}
        />
      </span>
      <span
        className={[
          "text-xs font-semibold uppercase tracking-wider",
          active ? "text-cyan-300" : "text-slate-500",
        ].join(" ")}
      >
        {label}
      </span>
    </div>
  );
}

/**
 * RL optimization control panel for V2B smart-grid operations (demo data).
 *
 * @param {object} [props]
 * @param {typeof DEMO_METRICS} [props.metrics]
 * @param {typeof DEMO_RECOMMENDATIONS} [props.recommendations]
 * @param {string} [props.className]
 */
function OptimizationPanelInner({
  metrics: metricsProp,
  recommendations: recommendationsProp,
  className = "",
}) {
  const { optimization, loading, error, isLive, lastUpdated, refresh } = useOpsPanelSlice("optimization");

  const metrics = useMemo(
    () => metricsProp ?? optimization?.metrics ?? EMPTY_METRICS,
    [metricsProp, optimization],
  );
  const recommendations = useMemo(
    () => recommendationsProp ?? optimization?.recommendations ?? [],
    [recommendationsProp, optimization],
  );

  const [optStatus, setOptStatus] = useState("idle"); // idle | running | complete
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [aiStatus] = useState({
    model: "DDPG Actor loaded",
    device: "GPU · CUDA",
    stateDim: 23,
    actionDim: 8,
    policy: "Deterministic μ(s)",
    healthy: true,
  });
  const [lastRun, setLastRun] = useState(null);

  const isRunning = optStatus === "running";
  const isComplete = optStatus === "complete";

  const runOptimization = useCallback(() => {
    if (isRunning) return;
    setOptStatus("running");
    setPhaseIndex(0);
    setLastRun(null);
  }, [isRunning]);

  useEffect(() => {
    if (!isRunning) return;

    if (phaseIndex >= OPTIMIZATION_PHASES.length - 1) {
      const timer = setTimeout(() => {
        setOptStatus("complete");
        setLastRun(new Date());
      }, 600);
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(() => setPhaseIndex((i) => i + 1), 700);
    return () => clearTimeout(timer);
  }, [isRunning, phaseIndex]);

  const statusLabel = useMemo(() => {
    if (isRunning) return OPTIMIZATION_PHASES[phaseIndex];
    if (isComplete) return "Last run successful · policy aligned with telemetry";
    return "Ready · awaiting operator command";
  }, [isRunning, isComplete, phaseIndex]);

  const statusColor = isRunning
    ? "text-cyan-300"
    : isComplete
      ? "text-emerald-300"
      : "text-slate-400";

  if (loading && !metricsProp) {
    return <PanelSkeleton className={className} rows={6} />;
  }

  if (error && !metricsProp && !optimization) {
    return <TelemetryError message={error} onRetry={refresh} className={className} />;
  }

  return (
    <section
      className={["relative", className].join(" ")}
      aria-labelledby="optimization-panel-title"
    >
      <div
        className={[
          "relative overflow-hidden rounded-2xl border border-cyan-500/15",
          "bg-white/[0.02] p-4 backdrop-blur-md sm:p-6",
          "transition-shadow duration-300 hover:shadow-[0_0_48px_rgba(34,211,238,0.08)]",
        ].join(" ")}
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/50 to-emerald-400/30"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -right-20 top-1/2 h-56 w-56 -translate-y-1/2 rounded-full bg-emerald-500/5 blur-[100px]"
          aria-hidden
        />

        {/* Header */}
        <header className="relative mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500/20 to-emerald-500/10 ring-1 ring-cyan-400/30 shadow-neon-cyan">
              <CpuIcon className="h-6 w-6 text-cyan-400" />
            </div>
            <div>
              <p className="font-display text-[10px] font-semibold uppercase tracking-[0.28em] text-emerald-500/80">
                RL Control
              </p>
              <h2
                id="optimization-panel-title"
                className="font-display text-xl font-bold text-white sm:text-2xl"
              >
                AI Optimization Center
              </h2>
              <p className="mt-1 max-w-lg text-sm text-slate-400">
                RL optimization from rl_reward_signal, renewable_ratio, and peak_penalty
                telemetry.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <LiveBadge isLive={isLive} lastUpdated={lastUpdated} />
            <LiveIndicator active={isRunning || isComplete} label="Live optimization" />
            <LiveIndicator active={aiStatus.healthy} label="AI system online" />
          </div>
        </header>

        <div className="relative grid grid-cols-1 gap-6 xl:grid-cols-12">
          {/* Left: controls + status */}
          <div className="space-y-4 xl:col-span-5">
            <div
              className={[
                "rounded-xl border bg-white/[0.03] p-4 backdrop-blur-sm sm:p-5",
                isRunning
                  ? "border-cyan-400/30 shadow-[0_0_32px_rgba(34,211,238,0.12)]"
                  : "border-white/10",
              ].join(" ")}
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                Optimization status
              </p>
              <p className={["mt-2 font-mono text-sm", statusColor].join(" ")}>
                {statusLabel}
              </p>

              {isRunning ? (
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-500 transition-all duration-300"
                    style={{
                      width: `${((phaseIndex + 1) / OPTIMIZATION_PHASES.length) * 100}%`,
                    }}
                  />
                </div>
              ) : null}

              {lastRun ? (
                <p className="mt-2 text-[11px] text-slate-500">
                  Last run:{" "}
                  {lastRun.toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </p>
              ) : null}

              <button
                type="button"
                onClick={runOptimization}
                disabled={isRunning}
                className={[
                  "group relative mt-5 w-full overflow-hidden rounded-xl py-3.5 text-sm font-bold tracking-wide",
                  "bg-gradient-to-r from-cyan-500 to-emerald-500 text-slate-950",
                  "transition-all duration-300 hover:shadow-neon-button hover:brightness-110",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950",
                  "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:shadow-none",
                ].join(" ")}
              >
                <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                <span className="relative flex items-center justify-center gap-2">
                  {isRunning ? (
                    <>
                      <Spinner />
                      Optimizing…
                    </>
                  ) : (
                    <>
                      <BoltIcon className="h-4 w-4" />
                      Run AI Optimization
                    </>
                  )}
                </span>
              </button>
            </div>

            {/* AI system status */}
            <div className="rounded-xl border border-white/10 bg-slate-900/30 p-4 sm:p-5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                AI system status
              </p>
              <ul className="mt-3 space-y-2 text-sm">
                {[
                  ["Model", aiStatus.model],
                  ["Device", aiStatus.device],
                  ["State / Action", `${aiStatus.stateDim} / ${aiStatus.actionDim}`],
                  ["Policy", aiStatus.policy],
                ].map(([k, v]) => (
                  <li key={k} className="flex justify-between gap-4 border-b border-white/5 pb-2 last:border-0">
                    <span className="text-slate-500">{k}</span>
                    <span className="font-mono text-xs text-cyan-200/90">{v}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
                <span className="text-xs text-emerald-300/90">Inference engine ready</span>
              </div>
            </div>
          </div>

          {/* Right: metrics + recommendations */}
          <div className="space-y-4 xl:col-span-7">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <MetricActionCard
                icon={SavingsIcon}
                label="Predicted energy savings"
                value={`$${metrics.energySavingsUsd.toFixed(1)}`}
                sub={`${metrics.energySavingsPct}% vs baseline · ${metrics.episodesSimulated} ep sim`}
                accent="emerald"
              />
              <MetricActionCard
                icon={PeakIcon}
                label="Peak reduction estimate"
                value={`${metrics.peakReductionKw} kW`}
                sub={`${metrics.peakReductionPct}% below monthly peak`}
                accent="cyan"
              />
              <MetricActionCard
                icon={BoltIcon}
                label="Predicted RL reward"
                value={metrics.predictedReward.toFixed(1)}
                sub="Episode score · λ_D weighted"
                accent="violet"
              />
              <MetricActionCard
                icon={CpuIcon}
                label="Optimization mode"
                value={isComplete ? "Applied" : isRunning ? "Running" : "Standby"}
                sub="Live telemetry · RL signals"
                accent="amber"
              />
            </div>

            {/* Recommendations */}
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                Charging recommendations
              </p>
              <ul className="mt-3 space-y-3">
                {(recommendations ?? []).map((rec, index) => {
                  const a = ACCENT_CARD[rec.accent] ?? ACCENT_CARD.cyan;
                  return (
                    <li
                      key={rec.id}
                      className={[
                        "group rounded-lg border bg-white/[0.02] p-3 transition-all duration-300 hover:-translate-y-0.5 sm:p-4",
                        a.border,
                        a.glow,
                      ].join(" ")}
                      style={{
                        animationDelay: `${index * 80}ms`,
                      }}
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="font-display text-sm font-semibold text-white">
                            {rec.title}
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-slate-400">
                            {rec.detail}
                          </p>
                        </div>
                        <span
                          className={[
                            "shrink-0 rounded-md px-2 py-1 font-mono text-[11px] font-semibold ring-1",
                            rec.accent === "emerald"
                              ? "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30"
                              : rec.accent === "cyan"
                                ? "bg-cyan-500/10 text-cyan-300 ring-cyan-500/30"
                                : "bg-violet-500/10 text-violet-300 ring-violet-500/30",
                          ].join(" ")}
                        >
                          {rec.impact}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>

        <footer className="relative mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-4 text-[10px] text-slate-600">
          <span>V2B DDPG · Action masks · 8 heterogeneous agents</span>
          <span className="flex items-center gap-2">
            <span
              className={[
                "h-1.5 w-1.5 rounded-full",
                isRunning ? "animate-pulse bg-cyan-400" : "bg-slate-600",
              ].join(" ")}
            />
            AI optimization · grid intelligence
          </span>
        </footer>
      </div>
    </section>
  );
}

const OptimizationPanel = memo(OptimizationPanelInner);
OptimizationPanel.displayName = "OptimizationPanel";

export default OptimizationPanel;
