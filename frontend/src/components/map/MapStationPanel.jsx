import { memo } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { ASSET_COLORS } from "../../data/gridGeoAssets";

const STATUS_LABEL = {
  ok: { text: "Operational", color: "#34d399" },
  idle: { text: "Idle", color: "#64748b" },
  warning: { text: "Elevated", color: "#fbbf24" },
  critical: { text: "Critical", color: "#f87171" },
};

function MapStationPanel({ asset, onClose, weatherBlend = 0, weather, mapEffects }) {
  const status = STATUS_LABEL[asset?.status] ?? STATUS_LABEL.ok;
  const accent = ASSET_COLORS[asset?.type] ?? "#22d3ee";
  const weatherImpact = Math.round((mapEffects?.solarPenalty ?? 1) * (weatherBlend || 0) * 100);

  return (
    <AnimatePresence>
      {asset ? (
        <motion.aside
          key={asset.id}
          initial={{ x: -20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -20, opacity: 0 }}
          transition={{ type: "spring", stiffness: 360, damping: 30 }}
          className="map-side-panel glass-viz pointer-events-auto absolute left-3 top-3 z-[1100] w-[min(100%,340px)] overflow-hidden rounded-2xl border border-cyan-400/20 shadow-[0_0_40px_rgba(34,211,238,0.12)]"
        >
          <div
            className="h-1 w-full"
            style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
          />
          <div className="p-4">
            <header className="mb-4 flex items-start justify-between gap-2">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-cyan-500/80">Station Intelligence</p>
                <h3 className="font-display text-lg font-bold text-white">{asset.label}</h3>
                <p className="text-xs capitalize text-slate-400">{asset.type.replace("_", " ")}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-400 hover:text-white"
                aria-label="Close panel"
              >
                ✕
              </button>
            </header>

            <div className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-1.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
                <span className="relative h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300">AI Linked</span>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-2">
              <Metric label="Live Power" value={`${asset.kw} kW`} accent={accent} />
              <Metric label="Predicted Load" value={`${Math.round(asset.predictedLoad ?? 0)} kW`} />
              {asset.soc != null ? (
                <Metric label="SOC" value={`${Math.round(asset.soc)}%`} />
              ) : (
                <Metric label="Renewable" value={`${Math.round((asset.renewable ?? 0) * 100)}%`} />
              )}
              <Metric label="Grid Stress" value={`${Math.round((asset.stress ?? 0) * 100)}%`} />
              <Metric label="Thermal Index" value={`${Math.round((asset.thermal ?? 0) * 100)}%`} />
              <Metric label="Battery Health" value={`${Math.round((asset.batteryHealth ?? 0.9) * 100)}%`} />
              <Metric label="Weather Impact" value={`${weatherImpact}%`} accent="#fbbf24" />
              <Metric label="Conditions" value={weather?.condition ?? "—"} />
            </div>

            <div className="mb-3 rounded-xl border border-violet-500/15 bg-violet-500/5 p-3">
              <p className="mb-1 text-[10px] uppercase tracking-wider text-violet-300/80">AI Recommendation</p>
              <p className="text-sm text-cyan-100">{asset.optimization ?? "Monitoring"}</p>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2">
              <span className="text-xs text-slate-400">Operational Status</span>
              <span className="text-xs font-semibold" style={{ color: status.color }}>
                {status.text}
              </span>
            </div>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}

function Metric({ label, value, accent }) {
  return (
    <div className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-2.5 py-2">
      <p className="text-[9px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className="truncate text-sm font-semibold tabular-nums" style={{ color: accent ?? "#e2e8f0" }}>
        {value}
      </p>
    </div>
  );
}

export default memo(MapStationPanel);
