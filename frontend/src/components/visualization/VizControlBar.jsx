import { memo } from "react";

import { useVisualizationPrefs } from "../../context/VisualizationPrefsContext";

function VizControlBar({ className = "" }) {
  const {
    quality,
    paused,
    autoRotate,
    showLabels,
    focusNodeId,
    setQuality,
    togglePaused,
    toggleAutoRotate,
    toggleShowLabels,
    setFocusNodeId,
  } = useVisualizationPrefs();

  return (
    <div
      className={[
        "flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/50 p-2 backdrop-blur-xl",
        className,
      ].join(" ")}
    >
      <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-400">
        Quality
        <select
          value={quality}
          onChange={(e) => setQuality(e.target.value)}
          className="rounded-md border border-white/10 bg-black/60 px-2 py-1 text-xs text-cyan-200"
        >
          <option value="ultra">Ultra</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </label>
      <ToggleBtn active={autoRotate} onClick={toggleAutoRotate} label="Cinematic orbit" />
      <ToggleBtn active={!paused} onClick={togglePaused} label="FX" />
      <ToggleBtn active={showLabels} onClick={toggleShowLabels} label="Hover labels" />
      {focusNodeId ? (
        <button
          type="button"
          onClick={() => setFocusNodeId(null)}
          className="rounded-md border border-violet-400/30 px-2 py-1 text-[10px] text-violet-200 transition-colors hover:bg-violet-500/10"
        >
          Reset camera
        </button>
      ) : null}
    </div>
  );
}

function ToggleBtn({ active, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-md px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-all duration-200",
        active
          ? "border border-cyan-400/40 bg-cyan-500/15 text-cyan-200 shadow-neon-cyan"
          : "border border-white/10 text-slate-400 hover:text-slate-200",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

export default memo(VizControlBar);
