import { memo } from "react";
import { motion } from "framer-motion";

function TwinHUD({ latest, inference, weather, renewableBlend, visible }) {
  if (!visible) return null;

  const load = Math.round(Number(latest?.grid_load_kw) || 0);
  const renewable = Math.round(renewableBlend * 100);
  const soc = Math.round(Number(latest?.soc_percent) || 0);
  const stress = Math.round((Number(latest?.grid_stress_index) || 0) * 100);
  const aiAction = inference?.optimization_action ?? "Monitoring";

  const items = [
    { label: "Grid Load", value: `${load} kW`, accent: "#22d3ee" },
    { label: "Renewable", value: `${renewable}%`, accent: "#34d399" },
    { label: "Battery SOC", value: `${soc}%`, accent: "#a78bfa" },
    { label: "Stress", value: `${stress}%`, accent: stress > 60 ? "#f87171" : "#fbbf24" },
    { label: "AI Action", value: aiAction, accent: "#67e8f9", wide: true },
    { label: "Weather", value: weather?.condition ?? "—", accent: "#94a3b8" },
  ];

  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-4">
      <motion.div
        initial={{ y: -12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="twin-hud glass-viz flex max-w-3xl flex-wrap items-center justify-center gap-x-4 gap-y-2 rounded-2xl border border-cyan-400/15 px-4 py-2.5 shadow-[0_0_30px_rgba(34,211,238,0.08)]"
      >
        {items.map((item) => (
          <div
            key={item.label}
            className={item.wide ? "min-w-[140px] text-center sm:text-left" : "text-center sm:text-left"}
          >
            <p className="text-[9px] uppercase tracking-[0.16em] text-slate-500">{item.label}</p>
            <p
              className="max-w-[160px] truncate text-xs font-semibold tabular-nums sm:max-w-none sm:text-sm"
              style={{ color: item.accent }}
            >
              {item.value}
            </p>
          </div>
        ))}
      </motion.div>
    </div>
  );
}

export default memo(TwinHUD);
