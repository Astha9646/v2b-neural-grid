import { memo, useEffect, useMemo, useState } from "react";
import { CircleMarker, Polyline, useMap } from "react-leaflet";

import {
  pointAlongPath,
  particlePhase,
  FLOW_STYLE,
  bezierPath,
} from "./mapUtils";
import { assetById } from "../../data/gridGeoAssets";

const PARTICLE_TICK = 120;

function resolveFlowRoutes(assets, flows, loadKw = 0) {
  return flows
    .map((route) => {
      const from = assetById(route.from, assets);
      const to = assetById(route.to, assets);
      if (!from || !to) return null;
      const coords = bezierPath([from.lat, from.lng], [to.lat, to.lng]);
      const loadFactor = Math.min(2.2, Math.max(0.4, loadKw / 200 || 0.8));
      return {
        ...route,
        coords,
        loadFactor,
        style: FLOW_STYLE[route.kind] ?? FLOW_STYLE.grid,
      };
    })
    .filter(Boolean);
}

function FlowRoutesLayer({ visible, paused, renewableHighlight, assets, flows, loadKw, intense }) {
  const routes = useMemo(() => resolveFlowRoutes(assets, flows, loadKw), [assets, flows, loadKw]);
  const activeRoutes = renewableHighlight
    ? routes.filter((r) => r.kind === "renewable" || r.kind === "v2b")
    : routes;

  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!visible || paused) return;
    const id = setInterval(() => setTick((t) => t + 1), PARTICLE_TICK);
    return () => clearInterval(id);
  }, [visible, paused]);

  if (!visible) return null;

  return (
    <>
      {activeRoutes.map((route) => (
        <Polyline
          key={route.id}
          positions={route.coords}
          pathOptions={{
            color: route.style.color,
            weight: (renewableHighlight ? 3 : 2.5) * (intense ? 1.3 : 1) * route.loadFactor,
            opacity: renewableHighlight ? 0.9 : intense ? 0.75 : 0.55,
            className: paused ? "" : "neon-flow-line",
          }}
        />
      ))}
      {!paused &&
        activeRoutes.slice(0, 6).map((route, ri) =>
          [0, 0.33, 0.66].map((_, pi) => {
            const t = particlePhase(route.id, pi + ri, 3);
            const pt = pointAlongPath(route.coords, t);
            if (!pt) return null;
            return (
              <CircleMarker
                key={`${route.id}-${pi}-${tick}`}
                center={pt}
                radius={4}
                pathOptions={{
                  color: route.style.glow,
                  fillColor: route.style.color,
                  fillOpacity: 0.95,
                  weight: 0,
                  className: "flow-particle",
                }}
              />
            );
          }),
        )}
    </>
  );
}

export function MapFlyTo({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(center, zoom, { duration: 1.2, easeLinearity: 0.25 });
  }, [map, center, zoom]);
  return null;
}

export default memo(FlowRoutesLayer);
