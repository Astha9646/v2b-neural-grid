import { memo, useState } from "react";
import { Link } from "react-router-dom";

import { StreamBadge } from "../telemetry/TelemetryStates";
import { useStreamMeta } from "../../hooks/useTelemetrySelectors";
import StoryModePanel from "../story/StoryModePanel";
import IsometricCity from "./IsometricCity";
import IntelligencePanel from "./IntelligencePanel";
import BottomAnalyticsStrip from "./BottomAnalyticsStrip";

function CommandCenterView({ fullScreen = false }) {
  const [selectedZone, setSelectedZone] = useState(null);
  const { isStreaming, streamStatus, lastUpdated } = useStreamMeta();

  return (
    <div className={`command-center min-w-0 space-y-4 ${fullScreen ? "viz-page" : ""}`}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="section-eyebrow">Neural Grid OS</p>
          <h1 className="font-display text-2xl font-bold text-white sm:text-3xl">AI Command Center</h1>
          <p className="section-subheading max-w-2xl">
            Cinematic isometric smart-city · live energy routing · AI optimization story mode
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <StoryModePanel />
          <StreamBadge isStreaming={isStreaming} streamStatus={streamStatus} lastUpdated={lastUpdated} />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_300px] 2xl:grid-cols-[1fr_320px]">
        <IsometricCity
          selectedZoneId={selectedZone}
          onSelectZone={setSelectedZone}
          className={fullScreen ? "min-h-[min(72vh,680px)]" : "min-h-[min(62vh,560px)]"}
        />
        <IntelligencePanel zoneId={selectedZone} onClear={() => setSelectedZone(null)} />
      </div>

      <BottomAnalyticsStrip />

      {!fullScreen ? (
        <div className="flex flex-wrap gap-2 pt-2">
          <DeckLink to="/analytics" label="Deep Analytics" />
          <DeckLink to="/smart-grid-map" label="Smart Grid Map" />
          <DeckLink to="/ai-decisions" label="AI Optimization" />
          <DeckLink to="/fleet" label="EV Fleet" />
          <DeckLink to="/forecast-sustainability" label="Forecasting" />
        </div>
      ) : null}
    </div>
  );
}

function DeckLink({ to, label }) {
  return (
    <Link
      to={to}
      className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-[11px] font-medium text-slate-400 transition-all hover:border-cyan-400/25 hover:text-cyan-200"
    >
      {label}
    </Link>
  );
}

export default memo(CommandCenterView);
