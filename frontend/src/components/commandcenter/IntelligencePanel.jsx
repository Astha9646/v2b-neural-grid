import { memo } from "react";
import { motion, AnimatePresence } from "framer-motion";

import { useGridSyncState } from "../../hooks/useGridSyncState";
import { useWeather } from "../../context/WeatherContext";
import { useStoryMode } from "../../context/StoryModeContext";
import { zoneById } from "./isometricLayout";

const TYPE_COLORS = {
  building: "#94a3b8",
  solar: "#fbbf24",
  battery: "#a78bfa",
  ev_charger: "#22d3ee",
  substation: "#f97316",
};

function IntelligencePanel({ zoneId, onClear, className = "" }) {
  const { assets, latest, inference, alerts } = useGridSyncState();
  const { weather, renewableBlend, mapEffects } = useWeather();
  const { active: storyActive, phase, summary } = useStoryMode();

  const zone = zoneId ? zoneById(zoneId) : null;
  const asset = zone
    ? assets.find((a) => a.type === zone.type) ?? assets[0]
    : assets.find((a) => a.type === "building") ?? assets[0];

  const stress = Math.round((asset?.stress ?? latest?.grid_stress_index ?? 0) * 100);
  const thermal = Math.round((asset?.thermal ?? latest?.thermal_index ?? 0) * 100);
  const health = Math.round((asset?.batteryHealth ?? 0.9) * 100);
  const weatherImpact = Math.round((mapEffects?.solarPenalty ?? 1) * renewableBlend * 100);

  return (
    <aside
      className={[
        "intelligence-panel glass-viz flex h-full min-h-[480px] flex-col overflow-hidden rounded-2xl border border-violet-500/15 shadow-[0_0_40px_rgba(139,92,246,0.06)]",
        className,
      ].join(" ")}
    >
      <div className="h-1 w-full bg-gradient-to-r from-transparent via-violet-400/60 to-transparent" />
      <div className="flex flex-1 flex-col p-4">
        <header className="mb-4">
          <p className="text-[10px] uppercase tracking-[0.2em] text-violet-400/80">Station Intelligence</p>
          <h2 className="font-display text-lg font-bold text-white">{zone?.label ?? "Grid Overview"}</h2>
          <p className="text-xs text-slate-500">{zone ? zone.type.replace("_", " ") : "Select a city zone"}</p>
          {zoneId ? (
            <button type="button" onClick={onClear} className="mt-2 text-[10px] text-cyan-400 hover:underline">
              View grid overview
            </button>
          ) : null}
        </header>

        <AnimatePresence mode="wait">
          {summary ? (
            <motion.div
              key="summary"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 rounded-xl border border-emerald-400/20 bg-emerald-500/5 p-3"
            >
              <p className="text-[10px] uppercase tracking-wider text-emerald-400">AI Executive Summary</p>
              <p className="mt-1 text-sm text-slate-200">{summary}</p>
            </motion.div>
          ) : storyActive ? (
            <motion.div
              key="story"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mb-4 rounded-xl border border-amber-400/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-100"
            >
              <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" />
              {phase.label}
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div className="grid grid-cols-2 gap-2">
          <IntelMetric label="Live Power" value={`${asset?.kw ?? "—"} kW`} accent={TYPE_COLORS[zone?.type ?? "building"]} />
          <IntelMetric label="Predicted Demand" value={`${Math.round(asset?.predictedLoad ?? latest?.peak_demand_kw ?? 0)} kW`} />
          <IntelMetric label="Battery Health" value={`${health}%`} accent="#a78bfa" />
          <IntelMetric label="Grid Stress" value={`${stress}%`} accent={stress > 60 ? "#f87171" : "#fbbf24"} />
          <IntelMetric label="Thermal Status" value={`${thermal}%`} />
          <IntelMetric label="Renewable Use" value={`${Math.round((asset?.renewable ?? renewableBlend) * 100)}%`} accent="#34d399" />
          <IntelMetric label="Weather Impact" value={`${weatherImpact}%`} accent="#fbbf24" />
          <IntelMetric label="Conditions" value={weather?.condition ?? "—"} />
        </div>

        <div className="mt-4 rounded-xl border border-cyan-500/15 bg-cyan-500/5 p-3">
          <p className="mb-1 text-[10px] uppercase tracking-wider text-cyan-400/80">AI Recommendation</p>
          <p className="text-sm leading-relaxed text-slate-200">{asset?.optimization ?? inference?.optimization_action ?? "Monitoring equilibrium"}</p>
        </div>

        {alerts?.length ? (
          <div className="mt-4 flex-1 overflow-y-auto">
            <p className="mb-2 text-[10px] uppercase tracking-wider text-amber-400/80">Active Alerts ({alerts.length})</p>
            <ul className="space-y-2">
              {alerts.slice(0, 4).map((a) => (
                <li key={a.id} className="rounded-lg border border-white/[0.06] bg-black/20 px-2.5 py-2 text-xs text-slate-300">
                  <span className="font-medium text-amber-200">{a.title}</span>
                  <p className="mt-0.5 text-slate-500">{a.message}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function IntelMetric({ label, value, accent }) {
  return (
    <div className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-2.5 py-2">
      <p className="text-[9px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className="truncate text-sm font-semibold tabular-nums" style={{ color: accent ?? "#e2e8f0" }}>
        {value}
      </p>
    </div>
  );
}

export default memo(IntelligencePanel);
