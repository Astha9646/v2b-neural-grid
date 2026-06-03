import { lazy, Suspense } from "react";

import { StreamBadge } from "../components/telemetry/TelemetryStates";
import { useStreamMeta } from "../hooks/useTelemetrySelectors";

const SmartGridMap = lazy(() => import("../components/map/SmartGridMap"));

function MapFallback() {
  return (
    <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-cyan-500/15 bg-black/40 text-sm text-slate-500">
      Loading smart grid map…
    </div>
  );
}

export default function SmartGridMapPage() {
  const { isStreaming, streamStatus, lastUpdated } = useStreamMeta();

  return (
    <div className="min-w-0 space-y-6 viz-page">
      <header className="flex min-w-0 flex-wrap items-end justify-between gap-3">
        <div>
          <p className="section-eyebrow">Geospatial</p>
          <h1 className="font-display text-2xl font-bold text-white">Smart Grid Map</h1>
          <p className="section-subheading">
            Live EV hubs, renewables, storage, and grid stress — synced with WebSocket telemetry
          </p>
        </div>
        <StreamBadge isStreaming={isStreaming} streamStatus={streamStatus} lastUpdated={lastUpdated} />
      </header>

      <Suspense fallback={<MapFallback />}>
        <SmartGridMap className="min-h-[min(70vh,640px)] h-[min(70vh,640px)]" />
      </Suspense>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <LegendSwatch color="#22d3ee" label="EV / V2B" />
        <LegendSwatch color="#34d399" label="Solar" />
        <LegendSwatch color="#a78bfa" label="Battery" />
        <LegendSwatch color="#f97316" label="Stress zone" />
      </div>
    </div>
  );
}

function LegendSwatch({ color, label }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-slate-400">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
      {label}
    </div>
  );
}
