import { lazy, Suspense } from "react";

import VizControlBar from "../components/visualization/VizControlBar";
import { StreamBadge } from "../components/telemetry/TelemetryStates";
import { useStreamMeta } from "../hooks/useTelemetrySelectors";

const Twin3DCanvas = lazy(() => import("../components/twin3d/Twin3DCanvas"));

function TwinFallback() {
  return (
    <div className="flex min-h-[480px] items-center justify-center rounded-2xl border border-violet-500/15 bg-black/40 text-sm text-slate-500">
      Loading 3D digital twin…
    </div>
  );
}

export default function DigitalTwin3DPage() {
  const { isStreaming, streamStatus, lastUpdated } = useStreamMeta();

  return (
    <div className="min-w-0 space-y-6 viz-page">
      <header className="flex min-w-0 flex-wrap items-end justify-between gap-3">
        <div>
          <p className="section-eyebrow">Immersive</p>
          <h1 className="font-display text-2xl font-bold text-white">3D Digital Twin</h1>
          <p className="section-subheading">
            Interactive smart city — orbit, zoom, click nodes to focus · live energy routing
          </p>
        </div>
        <StreamBadge isStreaming={isStreaming} streamStatus={streamStatus} lastUpdated={lastUpdated} />
      </header>

      <VizControlBar />

      <Suspense fallback={<TwinFallback />}>
        <Twin3DCanvas className="min-h-[min(72vh,680px)] h-[min(72vh,680px)]" />
      </Suspense>

      <p className="text-center text-[10px] text-slate-500">
        Drag to rotate · Scroll to zoom · Click a node to focus camera · Low graphics mode available for mobile
      </p>
    </div>
  );
}
