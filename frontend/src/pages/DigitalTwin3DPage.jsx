import { lazy, Suspense } from "react";

import VizControlBar from "../components/visualization/VizControlBar";
import StoryModePanel from "../components/story/StoryModePanel";
import { StreamBadge } from "../components/telemetry/TelemetryStates";
import { useStreamMeta } from "../hooks/useTelemetrySelectors";

const Twin3DCanvas = lazy(() => import("../components/twin3d/Twin3DCanvas"));

function TwinFallback() {
  return (
    <div className="flex min-h-[520px] items-center justify-center rounded-2xl border border-violet-500/15 bg-gradient-to-b from-black/60 to-violet-950/20 text-sm text-slate-500">
      Loading cinematic digital twin…
    </div>
  );
}

export default function DigitalTwin3DPage() {
  const { isStreaming, streamStatus, lastUpdated } = useStreamMeta();

  return (
    <div className="min-w-0 space-y-5 viz-page">
      <header className="flex min-w-0 flex-wrap items-end justify-between gap-3">
        <div>
          <p className="section-eyebrow">Immersive Twin</p>
          <h1 className="font-display text-2xl font-bold text-white">3D Digital Twin</h1>
          <p className="section-subheading max-w-xl">
            Cinematic AI smart city — run Story Mode to watch live optimization unfold
          </p>
        </div>
        <StreamBadge isStreaming={isStreaming} streamStatus={streamStatus} lastUpdated={lastUpdated} />
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <VizControlBar className="flex-1" />
        <StoryModePanel />
      </div>

      <Suspense fallback={<TwinFallback />}>
        <Twin3DCanvas className="min-h-[min(76vh,740px)] h-[min(76vh,740px)]" />
      </Suspense>
    </div>
  );
}
