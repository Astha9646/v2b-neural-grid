import { memo, useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

import { useGridSyncState } from "../../hooks/useGridSyncState";
import { useWeather } from "../../context/WeatherContext";
import { useCityPreset } from "../../context/CityPresetContext";
import { useStoryMode } from "../../context/StoryModeContext";

import { AssetMarkerLayer, AlertMarkerLayer, useMapZoomState } from "./AssetMarkerLayer";
import FlowRoutesLayer, { MapFlyTo } from "./FlowRoutesLayer";
import StressHeatLayer from "./StressHeatLayer";
import MapStationPanel from "./MapStationPanel";
import MapControls from "./MapControls";
import MapLegendFilter from "./MapLegendFilter";
import ExecutiveHUD from "../hud/ExecutiveHUD";

const BASE_TILE = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const LABEL_TILE = "https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png";

const DEFAULT_FILTERS = {
  ev_charger: true,
  solar: true,
  battery: true,
  building: true,
  utility: true,
  substation: true,
  alerts: true,
};

function MapResizeFix() {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 250);
    return () => clearTimeout(t);
  }, [map]);
  return null;
}

function MapInner({
  assets,
  alerts,
  stress,
  heatPoints,
  selected,
  onSelect,
  filters,
  liveMode,
  paused,
  showStress,
  showRenewable,
  showFlows,
  showAiRoutes,
  flows,
  loadKw,
  flowIntense,
}) {
  const { zoom, setZoom, MapZoomTracker } = useMapZoomState();
  const { center } = useCityPreset();

  return (
    <>
      <MapFlyTo center={[center.lat, center.lng]} zoom={center.zoom} />
      <TileLayer attribution="&copy; OSM &copy; CARTO" url={BASE_TILE} />
      <TileLayer url={LABEL_TILE} opacity={0.6} />
      <MapResizeFix />
      <MapZoomTracker onZoom={setZoom} />

      <StressHeatLayer points={heatPoints} visible={showStress} stress={stress} />
      <FlowRoutesLayer
        visible={showFlows || showAiRoutes}
        paused={paused || !liveMode}
        renewableHighlight={showRenewable}
        assets={assets}
        flows={flows}
        loadKw={loadKw}
        intense={flowIntense || showAiRoutes}
      />
      <AssetMarkerLayer
        assets={assets}
        filters={filters}
        selectedId={selected?.id}
        onSelect={onSelect}
        liveMode={liveMode}
        zoom={zoom}
      />
      {filters.alerts !== false ? <AlertMarkerLayer alerts={alerts} assets={assets} /> : null}
    </>
  );
}

function WeatherOverlay({ mapEffects, showRenewable }) {
  if (!mapEffects) return null;
  const { cloudDim, solarGlow, rain, fog, thermalStress } = mapEffects;

  return (
    <div className="pointer-events-none absolute inset-0 z-[900]" aria-hidden>
      {showRenewable ? (
        <div
          className="absolute inset-0 transition-opacity duration-1000"
          style={{
            background: `radial-gradient(ellipse at 18% 8%, rgba(251,191,36,${solarGlow * 0.14}) 0%, transparent 52%)`,
          }}
        />
      ) : null}
      <div
        className="absolute inset-0 transition-opacity duration-1000"
        style={{ background: `rgba(15,23,42,${cloudDim * 0.45})` }}
      />
      {thermalStress > 0.2 ? (
        <div
          className="absolute inset-0 mix-blend-overlay"
          style={{ background: `rgba(249,115,22,${thermalStress * 0.08})` }}
        />
      ) : null}
      {fog ? <div className="absolute inset-0 bg-slate-400/10 backdrop-blur-[1px]" /> : null}
      {rain ? <div className="map-rain-overlay absolute inset-0 opacity-45" /> : null}
    </div>
  );
}

function SmartGridMap({ className = "" }) {
  const { assets, alerts, latest, heatPoints, stress, inference } = useGridSyncState();
  const { weather, renewableBlend, mapEffects } = useWeather();
  const { flows } = useCityPreset();
  const { storyFlags } = useStoryMode();

  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [liveMode, setLiveMode] = useState(true);
  const [paused, setPaused] = useState(false);
  const [showStress, setShowStress] = useState(true);
  const [showRenewable, setShowRenewable] = useState(false);
  const [showFlows, setShowFlows] = useState(true);
  const [showAiRoutes, setShowAiRoutes] = useState(false);
  const { center } = useCityPreset();

  const loadKw = Number(latest?.grid_load_kw) || 0;
  const toggleFilter = (id) => setFilters((f) => ({ ...f, [id]: !f[id] }));

  return (
    <div
      className={[
        "map-os-shell relative overflow-hidden rounded-2xl border border-cyan-500/20 shadow-[0_0_60px_rgba(34,211,238,0.06)]",
        className,
      ].join(" ")}
    >
      <ExecutiveHUD compact className="absolute left-1/2 top-3 z-[1040] -translate-x-1/2" />

      <MapContainer
        key={center.lat + center.lng}
        center={[center.lat, center.lng]}
        zoom={center.zoom}
        className="grid-map-canvas z-0"
        scrollWheelZoom
        zoomControl={false}
        style={{ height: "100%", width: "100%", minHeight: 480, background: "#030712" }}
      >
        <MapInner
          assets={assets}
          alerts={alerts}
          stress={stress}
          heatPoints={heatPoints}
          selected={selected}
          onSelect={setSelected}
          filters={filters}
          liveMode={liveMode}
          paused={paused}
          showStress={showStress}
          showRenewable={showRenewable}
          showFlows={showFlows}
          showAiRoutes={showAiRoutes}
          flows={flows}
          loadKw={loadKw}
          flowIntense={storyFlags?.flowIntense}
        />
      </MapContainer>

      <MapStationPanel
        asset={selected}
        onClose={() => setSelected(null)}
        weatherBlend={renewableBlend}
        weather={weather}
        mapEffects={mapEffects}
      />

      <WeatherOverlay mapEffects={mapEffects} showRenewable={showRenewable} />

      <MapControls
        liveMode={liveMode}
        onToggleLive={() => setLiveMode((v) => !v)}
        showStress={showStress}
        onToggleStress={() => setShowStress((v) => !v)}
        showRenewable={showRenewable}
        onToggleRenewable={() => setShowRenewable((v) => !v)}
        showFlows={showFlows}
        onToggleFlows={() => setShowFlows((v) => !v)}
        showAiRoutes={showAiRoutes}
        onToggleAiRoutes={() => setShowAiRoutes((v) => !v)}
        paused={paused}
        onTogglePause={() => setPaused((v) => !v)}
      />

      <MapLegendFilter filters={filters} onToggle={toggleFilter} alertCount={alerts?.length ?? 0} />

      <div className="pointer-events-none absolute bottom-3 right-3 z-[1000] rounded-lg border border-cyan-400/15 bg-black/50 px-3 py-1.5 text-[10px] text-cyan-300/80 backdrop-blur-md">
        <span className={liveMode && !paused ? "map-live-dot-inline" : "text-slate-500"}>
          {liveMode && !paused ? "NEURAL GRID · LIVE" : "TELEMETRY PAUSED"}
        </span>
      </div>
    </div>
  );
}

export default memo(SmartGridMap);
