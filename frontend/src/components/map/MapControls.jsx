import { memo } from "react";

import { useCityPreset } from "../../context/CityPresetContext";

function MapControls({
  liveMode,
  onToggleLive,
  showStress,
  onToggleStress,
  showRenewable,
  onToggleRenewable,
  showFlows,
  onToggleFlows,
  showAiRoutes,
  onToggleAiRoutes,
  paused,
  onTogglePause,
}) {
  const { cityId, cities, selectCity } = useCityPreset();

  return (
    <div className="map-controls glass-viz pointer-events-auto absolute right-3 top-3 z-[1050] flex flex-col gap-1 rounded-xl border border-white/10 p-1.5 backdrop-blur-xl">
      <label className="px-1 pb-1">
        <span className="mb-1 block text-[9px] uppercase tracking-wider text-slate-500">City</span>
        <select
          value={cityId}
          onChange={(e) => selectCity(e.target.value)}
          className="w-full rounded-lg border border-white/10 bg-black/60 px-2 py-1.5 text-[11px] text-cyan-200"
        >
          {cities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <div className="my-0.5 h-px bg-white/10" />
      <CtrlBtn active={liveMode} onClick={onToggleLive} label="Live" icon="●" />
      <CtrlBtn active={!paused} onClick={onTogglePause} label={paused ? "Paused" : "Stream"} />
      <div className="my-0.5 h-px bg-white/10" />
      <CtrlBtn active={showStress} onClick={onToggleStress} label="Stress" />
      <CtrlBtn active={showRenewable} onClick={onToggleRenewable} label="Renewable" />
      <CtrlBtn active={showFlows} onClick={onToggleFlows} label="Energy" />
      <CtrlBtn active={showAiRoutes} onClick={onToggleAiRoutes} label="AI Routes" />
    </div>
  );
}

function CtrlBtn({ active, onClick, label, icon }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-all duration-200",
        active
          ? "bg-cyan-500/15 text-cyan-200 shadow-[inset_0_0_12px_rgba(34,211,238,0.15)]"
          : "text-slate-500 hover:bg-white/[0.04] hover:text-slate-300",
      ].join(" ")}
    >
      {icon ? (
        <span className={["text-[8px]", active ? "text-emerald-400 animate-pulse" : "text-slate-600"].join(" ")}>
          {icon}
        </span>
      ) : null}
      {label}
    </button>
  );
}

export default memo(MapControls);
