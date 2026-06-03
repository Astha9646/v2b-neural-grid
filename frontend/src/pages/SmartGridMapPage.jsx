import { lazy, Suspense } from "react";

import { StreamBadge } from "../components/telemetry/TelemetryStates";
import { useStreamMeta } from "../hooks/useTelemetrySelectors";

const SmartGridMap = lazy(() => import("../components/map/SmartGridMap"));

function MapFallback() {
  return (
    <div className="flex min-h-[520px] items-center justify-center rounded-2xl border border-cyan-500/15 bg-gradient-to-b from-black/60 to-cyan-950/20 text-sm text-slate-500">
      Initializing geospatial AI layer…
    </div>
  );
}

export default function SmartGridMapPage() {
  const { isStreaming, streamStatus, lastUpdated } = useStreamMeta();

  return (
    <div className="min-w-0 space-y-5 viz-page">
      <header className="flex min-w-0 flex-wrap items-end justify-between gap-3">
        <div>
          <p className="section-eyebrow">Geospatial Command</p>
          <h1 className="font-display text-2xl font-bold text-white">Smart Grid Map</h1>
          <p className="section-subheading max-w-xl">
            AI smart-city operating layer — live energy routing, stress heatmaps, and station intelligence
          </p>
        </div>
        <StreamBadge isStreaming={isStreaming} streamStatus={streamStatus} lastUpdated={lastUpdated} />
      </header>

      <Suspense fallback={<MapFallback />}>
        <SmartGridMap className="min-h-[min(75vh,720px)] h-[min(75vh,720px)]" />
      </Suspense>
    </div>
  );
}
