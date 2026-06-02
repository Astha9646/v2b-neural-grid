import { memo, useMemo } from "react";
import { useForecastSlice } from "../hooks/useTelemetrySelectors";
import { PanelSkeleton, TelemetryError } from "./telemetry/TelemetryStates";

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

function ConfidenceMeter({ value, label }) {
  const pct = Math.round((Number(value) || 0) * 100);
  return (
    <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/5 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 font-mono text-xl font-bold text-emerald-300">{pct}%</p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-cyan-500 transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function RenewableForecastPanelInner({ className = "" }) {
  const { forecast, forecastLoading, forecastError, refreshForecast } = useForecastSlice();

  const renewable = forecast?.renewable ?? {};
  const cards = useMemo(() => renewable.hourlyCards ?? [], [renewable.hourlyCards]);

  if (forecastLoading && !cards.length) {
    return <PanelSkeleton className={className} rows={4} />;
  }

  if (forecastError && !cards.length) {
    return <TelemetryError message={forecastError} onRetry={refreshForecast} className={className} />;
  }

  return (
    <section
      className={[
        "relative min-w-0 overflow-hidden rounded-2xl border border-emerald-500/20",
        "bg-gradient-to-br from-emerald-950/30 via-slate-950/80 to-slate-950/90 p-5 backdrop-blur-md",
        className,
      ].join(" ")}
      aria-labelledby="renewable-forecast-title"
    >
      <header className="mb-4 flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 ring-1 ring-emerald-400/30">
          <SunIcon className="h-5 w-5 text-emerald-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-400/80">
            Renewable intelligence
          </p>
          <h3 id="renewable-forecast-title" className="break-words text-lg font-bold text-white">
            Solar & Renewable Forecast
          </h3>
          <p className="break-words text-sm text-slate-400">{renewable.insight ?? "Hourly renewable projection"}</p>
        </div>
      </header>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <ConfidenceMeter value={renewable.confidence} label="Forecast confidence" />
        <div className="rounded-xl border border-white/5 bg-slate-900/40 p-3">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Avg contribution</p>
          <p className="mt-1 font-mono text-xl font-bold text-emerald-300">
            {renewable.avgContributionPct ?? 0}%
          </p>
        </div>
        <div className="rounded-xl border border-white/5 bg-slate-900/40 p-3 col-span-2 sm:col-span-1">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Carbon savings (proj.)</p>
          <p className="mt-1 font-mono text-xl font-bold text-cyan-300">
            {renewable.projectedCarbonKg ?? 0} kg
          </p>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-amber-200">
          Solar peak: {renewable.peakSolarKw ?? 0} kW @ {renewable.peakSolarStep ?? "—"}
        </span>
        <span className="text-slate-500">
          Projected mix:{" "}
          <span className="font-mono font-bold text-emerald-300">
            {renewable.projectedContributionPct ?? 0}%
          </span>
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {cards.length ? (
          cards.map((card) => (
            <div
              key={card.label}
              className={[
                "rounded-xl border p-3 transition-all duration-300",
                card.isAvailabilityWindow
                  ? "border-emerald-400/40 bg-emerald-500/10 shadow-[0_0_20px_rgba(52,211,153,0.12)]"
                  : "border-white/5 bg-slate-900/50",
              ].join(" ")}
            >
              <p className="text-[10px] font-semibold uppercase text-slate-500">{card.label}</p>
              <p className="mt-1 font-mono text-lg font-bold text-white">{card.solarKw} kW</p>
              <p className="mt-0.5 text-[10px] text-emerald-400">{card.contributionPct}% mix</p>
              {card.isAvailabilityWindow ? (
                <span className="mt-2 inline-block rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-300">
                  Window
                </span>
              ) : null}
            </div>
          ))
        ) : (
          <p className="col-span-full py-6 text-center text-sm text-slate-500">No hourly forecast cards</p>
        )}
      </div>

      {(forecast?.insights ?? [])
        .filter((t) => /renewable|solar|carbon/i.test(t))
        .slice(0, 2)
        .map((text) => (
          <p
            key={text}
            className="mt-4 rounded-lg border border-emerald-500/15 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-100/90"
          >
            {text}
          </p>
        ))}
    </section>
  );
}

const RenewableForecastPanel = memo(RenewableForecastPanelInner);
RenewableForecastPanel.displayName = "RenewableForecastPanel";

export default RenewableForecastPanel;
