import { memo } from "react";

import { ASSET_COLORS } from "../../data/gridGeoAssets";
import { ASSET_FILTER_TYPES } from "./mapUtils";

function MapLegendFilter({ filters, onToggle, alertCount = 0 }) {
  return (
    <div className="map-legend glass-viz pointer-events-auto absolute bottom-3 left-3 z-[1050] max-w-[280px] rounded-xl border border-white/10 p-3 backdrop-blur-xl">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        Grid Layers
      </p>
      <ul className="space-y-1">
        {ASSET_FILTER_TYPES.map(({ id, label }) => {
          const on = filters[id] !== false;
          const color = ASSET_COLORS[id] ?? "#94a3b8";
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => onToggle(id)}
                className={[
                  "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-all",
                  on ? "text-slate-200" : "text-slate-600 line-through opacity-60",
                ].join(" ")}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: color, boxShadow: on ? `0 0 8px ${color}` : "none" }}
                />
                {label}
              </button>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={() => onToggle("alerts")}
            className={[
              "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-all",
              filters.alerts !== false ? "text-amber-300/90" : "text-slate-600 line-through opacity-60",
            ].join(" ")}
          >
            <span className="flex h-2 w-2 items-center justify-center rounded-sm bg-amber-400/30 text-[8px] font-bold text-amber-300">
              !
            </span>
            AI Alerts {alertCount > 0 ? `(${alertCount})` : ""}
          </button>
        </li>
      </ul>
      <div className="mt-2 flex flex-wrap gap-2 border-t border-white/[0.06] pt-2 text-[9px] text-slate-500">
        <FlowKey color="#fbbf24" label="Solar" />
        <FlowKey color="#38bdf8" label="Grid" />
        <FlowKey color="#a78bfa" label="Battery" />
        <FlowKey color="#22d3ee" label="EV" />
      </div>
    </div>
  );
}

function FlowKey({ color, label }) {
  return (
    <span className="flex items-center gap-1">
      <span className="h-0.5 w-3 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
      {label}
    </span>
  );
}

export default memo(MapLegendFilter);
