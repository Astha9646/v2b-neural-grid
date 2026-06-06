import { memo, useEffect, useState } from "react";
import { motion } from "framer-motion";

import { useGridSyncState } from "../../hooks/useGridSyncState";
import { useWeather } from "../../context/WeatherContext";
import { useStoryMode } from "../../context/StoryModeContext";

function AnimatedValue({ value, suffix = "" }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const target = Number(value) || 0;
    let frame;
    const start = performance.now();
    const dur = 900;
    const tick = (now) => {
      const p = Math.min(1, (now - start) / dur);
      setDisplay(Math.round(target * p));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return (
    <>
      {display}
      {suffix}
    </>
  );
}

function BottomAnalyticsStrip({ className = "" }) {
  const { latest, inference, stress } = useGridSyncState();
  const { renewableBlend } = useWeather();
  const { active: storyActive, phase } = useStoryMode();

  const renewable = Math.round(renewableBlend * 100);
  const stressPct = Math.round((stress ?? 0) * 100);
  const reward = Number(latest?.rl_reward_signal ?? 0).toFixed(2);
  const carbon = Math.round(Number(latest?.renewable_ratio ?? 0) * 120);

  const tiles = [
    { label: "Renewable Mix", value: renewable, suffix: "%", color: "#34d399" },
    { label: "Stress Heat", value: stressPct, suffix: "%", color: stressPct > 55 ? "#f87171" : "#fbbf24" },
    { label: "AI Reward", value: reward, suffix: "", color: "#67e8f9" },
    { label: "Carbon Offset", value: carbon, suffix: " kg", color: "#86efac" },
    {
      label: "Optimization",
      value: storyActive ? phase.label : inference?.optimization_action ?? "Active",
      suffix: "",
      color: "#c4b5fd",
      text: true,
    },
    { label: "Power Flow", value: Math.round(Number(latest?.grid_load_kw) || 0), suffix: " kW", color: "#22d3ee" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={[
        "bottom-analytics glass-viz grid grid-cols-2 gap-2 rounded-2xl border border-white/[0.08] p-3 sm:grid-cols-3 lg:grid-cols-6",
        className,
      ].join(" ")}
    >
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl border border-white/[0.04] bg-black/20 px-3 py-2.5 transition-colors hover:border-cyan-400/15">
          <p className="text-[9px] uppercase tracking-[0.14em] text-slate-500">{t.label}</p>
          <p
            className={["mt-0.5 font-semibold tabular-nums", t.text ? "truncate text-xs" : "text-lg"].join(" ")}
            style={{ color: t.color }}
          >
            {t.text ? (
              <span className="truncate">{t.value}</span>
            ) : (
              <>
                <AnimatedValue value={parseFloat(t.value) || 0} suffix={t.suffix} />
              </>
            )}
          </p>
        </div>
      ))}
    </motion.div>
  );
}

export default memo(BottomAnalyticsStrip);
