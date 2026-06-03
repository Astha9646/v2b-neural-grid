import { memo } from "react";
import { motion } from "framer-motion";

import { useGridSyncState } from "../../hooks/useGridSyncState";
import { useWeather } from "../../context/WeatherContext";
import { useStoryMode } from "../../context/StoryModeContext";

function ExecutiveHUD({ className = "", compact = false }) {
  const { latest, inference, alerts, stress } = useGridSyncState();
  const { weather, renewableBlend } = useWeather();
  const { active: storyActive, phase } = useStoryMode();

  const load = Math.round(Number(latest?.grid_load_kw) || 0);
  const renewable = Math.round(renewableBlend * 100);
  const soc = Math.round(Number(latest?.soc_percent) || 0);
  const stressPct = Math.round((stress ?? 0) * 100);
  const alertCount = alerts?.length ?? 0;

  const items = compact
    ? [
        { label: "Load", value: `${load}kW`, color: "#22d3ee" },
        { label: "Ren", value: `${renewable}%`, color: "#34d399" },
        { label: "Stress", value: `${stressPct}%`, color: stressPct > 60 ? "#f87171" : "#fbbf24" },
        { label: "SOC", value: `${soc}%`, color: "#a78bfa" },
      ]
    : [
        { label: "Grid Load", value: `${load} kW`, color: "#22d3ee" },
        { label: "Renewable", value: `${renewable}%`, color: "#34d399" },
        { label: "Stress", value: `${stressPct}%`, color: stressPct > 60 ? "#f87171" : "#fbbf24" },
        { label: "Battery SOC", value: `${soc}%`, color: "#a78bfa" },
        { label: "Weather", value: weather?.condition ?? "—", color: "#94a3b8" },
        { label: "AI State", value: storyActive ? phase.label : inference?.optimization_action ?? "Monitor", color: "#67e8f9" },
        { label: "Alerts", value: String(alertCount), color: alertCount ? "#fbbf24" : "#64748b" },
      ];

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className={[
        "executive-hud glass-viz pointer-events-none flex flex-wrap items-center justify-center gap-x-4 gap-y-1 rounded-2xl border border-cyan-400/15 px-4 py-2 shadow-[0_0_30px_rgba(34,211,238,0.06)]",
        compact ? "max-w-xl text-[10px]" : "max-w-4xl",
        className,
      ].join(" ")}
    >
      {items.map((item) => (
        <div key={item.label} className="text-center">
          <p className="text-[8px] uppercase tracking-[0.14em] text-slate-500">{item.label}</p>
          <p className="font-semibold tabular-nums" style={{ color: item.color }}>
            {item.value}
          </p>
        </div>
      ))}
    </motion.div>
  );
}

export default memo(ExecutiveHUD);
