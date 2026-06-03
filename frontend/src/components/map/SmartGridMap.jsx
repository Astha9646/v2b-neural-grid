import { memo, useEffect } from "react";
import { MapContainer, TileLayer, Circle, Polyline, Popup, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import {
  ASSET_COLORS,
  FLOW_COLORS,
  GRID_MAP_CENTER,
  routesWithCoords,
} from "../../data/gridGeoAssets";
import { useGridSyncState } from "../../hooks/useGridSyncState";

const DARK_TILE = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";

function statusColor(status) {
  if (status === "critical") return "#f87171";
  if (status === "warning") return "#fbbf24";
  if (status === "idle") return "#64748b";
  return ASSET_COLORS.ev_charger;
}

function makeIcon(asset) {
  const color = ASSET_COLORS[asset.type] ?? "#22d3ee";
  const pulse = asset.status === "critical" ? "animation: pulse 1.5s infinite;" : "";
  return L.divIcon({
    className: "grid-map-marker",
    html: `<span style="
      display:block;width:14px;height:14px;border-radius:50%;
      background:${color};box-shadow:0 0 12px ${color};
      border:2px solid rgba(255,255,255,0.35);${pulse}
    "></span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function MapResizeFix() {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 200);
    return () => clearTimeout(t);
  }, [map]);
  return null;
}

function AssetMarkers({ assets }) {
  return assets.map((asset) => (
    <MarkerWithPopup key={asset.id} asset={asset} />
  ));
}

const MarkerWithPopup = memo(function MarkerWithPopup({ asset }) {
  return (
    <Marker position={[asset.lat, asset.lng]} icon={makeIcon(asset)}>
      <Popup className="grid-map-popup">
        <div className="min-w-[160px] space-y-1 text-xs">
          <p className="font-semibold text-cyan-300">{asset.label}</p>
          <p className="text-slate-400 capitalize">{asset.type.replace("_", " ")}</p>
          <p>Power: <strong>{asset.kw} kW</strong></p>
          {asset.soc != null ? <p>SOC: <strong>{Math.round(asset.soc)}%</strong></p> : null}
          <p>Status: <span style={{ color: statusColor(asset.status) }}>{asset.status}</span></p>
          <p className="text-slate-500">AI: {asset.optimization}</p>
        </div>
      </Popup>
    </Marker>
  );
});

function FlowRoutes({ routes, visible }) {
  if (!visible) return null;
  const resolved = routesWithCoords();
  return resolved.map((route) => (
    <Polyline
      key={route.id}
      positions={route.coords}
      pathOptions={{
        color: FLOW_COLORS[route.kind] ?? "#22d3ee",
        weight: 3,
        opacity: 0.75,
        dashArray: route.kind === "renewable" ? "8 6" : undefined,
        className: "neon-flow-line",
      }}
    />
  ));
}

function HeatZones({ zones }) {
  return zones.map((z) => (
    <Circle
      key={z.id}
      center={[z.lat, z.lng]}
      radius={z.radiusM}
      pathOptions={{
        color: "#f97316",
        fillColor: "#f97316",
        fillOpacity: 0.08 + z.intensity * 0.15,
        weight: 1,
        opacity: 0.35,
      }}
    />
  ));
}

function AlertMarkers({ alerts, assets }) {
  if (!alerts?.length) return null;
  return alerts.slice(0, 5).map((alert, i) => {
    const anchor = assets[i % assets.length];
    if (!anchor) return null;
    const lat = anchor.lat + (i % 2 === 0 ? 0.0008 : -0.0006);
    const lng = anchor.lng + (i % 3 === 0 ? 0.001 : -0.0008);
    const severity = alert.severity ?? "medium";
    const color = severity === "critical" ? "#f87171" : severity === "high" ? "#fb923c" : "#fbbf24";
    const icon = L.divIcon({
      className: "grid-map-marker",
      html: `<span style="
        display:flex;align-items:center;justify-content:center;
        width:20px;height:20px;border-radius:4px;
        background:${color}22;border:2px solid ${color};
        box-shadow:0 0 14px ${color};font-size:10px;color:${color};
        animation:pulse 2s infinite;
      ">!</span>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
    return (
      <Marker key={alert.id ?? `alert-${i}`} position={[lat, lng]} icon={icon} zIndexOffset={1000}>
        <Popup className="grid-map-popup">
          <div className="min-w-[180px] space-y-1 text-xs">
            <p className="font-semibold text-amber-300">{alert.title ?? "AI Alert"}</p>
            <p className="text-slate-400">{alert.message ?? alert.detail ?? "—"}</p>
            <p>
              Severity:{" "}
              <span style={{ color }}>{severity}</span>
            </p>
            {alert.source ? <p className="text-slate-500">{alert.source}</p> : null}
          </div>
        </Popup>
      </Marker>
    );
  });
}

function SmartGridMap({ className = "", showHeat = true, showFlows = true }) {
  const { assets, heatZones, alerts } = useGridSyncState();

  return (
    <div className={["relative overflow-hidden rounded-2xl border border-cyan-500/15", className].join(" ")}>
      <MapContainer
        center={[GRID_MAP_CENTER.lat, GRID_MAP_CENTER.lng]}
        zoom={GRID_MAP_CENTER.zoom}
        className="grid-map-canvas z-0"
        scrollWheelZoom
        style={{ height: "100%", width: "100%", minHeight: 420, background: "#050810" }}
      >
        <TileLayer attribution='&copy; OSM &copy; CARTO' url={DARK_TILE} />
        <MapResizeFix />
        {showHeat ? <HeatZones zones={heatZones} /> : null}
        <FlowRoutes visible={showFlows} />
        <AssetMarkers assets={assets} />
        <AlertMarkers alerts={alerts} assets={assets} />
      </MapContainer>
      <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-[10px] text-slate-400 backdrop-blur-md">
        Live sync · OpenStreetMap · Cyber grid overlay
      </div>
    </div>
  );
}

export default memo(SmartGridMap);
