import { memo, useMemo } from "react";
import { useForecastSlice } from "../hooks/useTelemetrySelectors";
import { PanelSkeleton, TelemetryError } from "./telemetry/TelemetryStates";

const SEVERITY_STYLES = {
  critical: {
    badge: "bg-rose-500/20 text-rose-200 ring-rose-500/40",
    meter: "from-rose-600 to-orange-500",
    border: "border-rose-500/30",
  },
  high: {
    badge: "bg-amber-500/20 text-amber-200 ring-amber-500/40",
    meter: "from-amber-600 to-orange-500",
    border: "border-amber-500/30",
  },
  medium: {
    badge: "bg-cyan-500/20 text-cyan-200 ring-cyan-500/40",
    meter: "from-cyan-600 to-violet-500",
    border: "border-cyan-500/30",
  },
  low: {
    badge: "bg-emerald-500/20 text-emerald-200 ring-emerald-500/40",
    meter: "from-emerald-600 to-cyan-500",
    border: "border-emerald-500/30",
  },
};

function PeakIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 19V5M8 19V11M12 19V8M16 19V13M20 19V4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function RiskMeter({ probability, severity }) {
  const style = SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.medium;
  const pct = Math.min(100, Math.max(0, Number(probability) || 0));

  return (
    <div className={`rounded-xl border p-4 ${style.border} bg-slate-900/50`}>
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Overload probability
        </p>
        <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ring-1 ${style.badge}`}>
          {severity}
        </span>
      </div>
      <p className="mt-2 font-mono text-3xl font-bold text-white">{pct}%</p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
        <div
          className={[`h-full rounded-full bg-gradient-to-r transition-all duration-700`, style.meter].join(" ")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function PeakPredictionPanelInner({ className = "" }) {
  const { forecast, forecastLoading, forecastError, refreshForecast } = useForecastSlice();

  const peak = forecast?.peakPrediction ?? {};
  const timeline = useMemo(() => peak.timeline ?? [], [peak.timeline]);
  const mitigations = useMemo(() => peak.mitigations ?? [], [peak.mitigations]);
  const severity = peak.severity ?? "low";

  if (forecastLoading && !timeline.length) {
    return <PanelSkeleton className={className} rows={5} />;
  }

  if (forecastError && !timeline.length) {
    return <TelemetryError message={forecastError} onRetry={refreshForecast} className={className} />;
  }

  return (
    <section
      className={[
        "relative min-w-0 overflow-hidden rounded-2xl border border-rose-500/20",
        "bg-gradient-to-br from-rose-950/20 via-slate-950/80 to-slate-950/90 p-5 backdrop-blur-md",
        className,
      ].join(" ")}
      aria-labelledby="peak-prediction-title"
    >
      <header className="mb-4 flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/15 ring-1 ring-rose-400/30">
          <PeakIcon className="h-5 w-5 text-rose-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-rose-400/80">
            Peak intelligence
          </p>
          <h3 id="peak-prediction-title" className="break-words text-lg font-bold text-white">
            Peak Demand Prediction
          </h3>
          <p className="text-sm text-slate-400">
            Projected crest {peak.predictedPeakKw ?? 0} kW @ {peak.predictedPeakStep ?? "—"}
          </p>
        </div>
      </header>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <RiskMeter probability={peak.overloadProbability} severity={severity} />
        <div className="rounded-xl border border-white/5 bg-slate-900/40 p-4">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Max grid stress (forecast)</p>
          <p className="mt-1 font-mono text-3xl font-bold text-orange-300">{peak.maxStress ?? 0}%</p>
          <p className="mt-2 text-xs text-slate-500">
            Future stress envelope across {timeline.length || "—"} horizon steps
          </p>
        </div>
      </div>

      <div className="mb-4">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Projected peak timeline
        </p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {timeline.length ? (
            timeline.map((step) => (
              <div
                key={step.label}
                className={[
                  "min-w-[88px] shrink-0 rounded-lg border px-3 py-2 text-center",
                  step.risk === "high"
                    ? "border-rose-500/35 bg-rose-500/10"
                    : step.risk === "medium"
                      ? "border-amber-500/25 bg-amber-500/5"
                      : "border-white/5 bg-slate-900/50",
                ].join(" ")}
              >
                <p className="text-[10px] font-semibold text-slate-500">{step.label}</p>
                <p className="font-mono text-sm font-bold text-white">{step.loadKw} kW</p>
                <p className="text-[10px] text-orange-400">
                  {((Number(step.stress) > 1 ? Number(step.stress) : Number(step.stress) * 100) || 0).toFixed(0)}% stress
                </p>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-500">Timeline unavailable</p>
          )}
        </div>
      </div>

      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          AI mitigation recommendations
        </p>
        <ul className="space-y-2">
          {mitigations.length ? (
            mitigations.map((text) => (
              <li
                key={text}
                className="rounded-lg border border-cyan-500/15 bg-cyan-500/5 px-3 py-2 text-xs leading-relaxed text-slate-300"
              >
                {text}
              </li>
            ))
          ) : (
            <li className="text-sm text-slate-500">No mitigations suggested</li>
          )}
        </ul>
      </div>

      {(forecast?.insights ?? [])
        .filter((t) => /peak|stress|demand|surge/i.test(t))
        .slice(0, 2)
        .map((text) => (
          <p
            key={text}
            className="mt-4 rounded-lg border border-rose-500/15 bg-rose-500/5 px-3 py-2 text-xs text-rose-100/90"
          >
            {text}
          </p>
        ))}
    </section>
  );
}

const PeakPredictionPanel = memo(PeakPredictionPanelInner);
PeakPredictionPanel.displayName = "PeakPredictionPanel";

export default PeakPredictionPanel;
