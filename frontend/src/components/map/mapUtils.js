/** Flow color by kind — solar=yellow, grid=cyan, battery=purple, ev=electric blue */
export const FLOW_STYLE = Object.freeze({
  renewable: { color: "#fbbf24", glow: "#fcd34d" },
  grid: { color: "#38bdf8", glow: "#22d3ee" },
  discharge: { color: "#a78bfa", glow: "#c4b5fd" },
  v2b: { color: "#22d3ee", glow: "#67e8f9" },
  balance: { color: "#94a3b8", glow: "#cbd5e1" },
});

/** Quadratic bezier lat/lng path for smooth energy routes */
export function bezierPath(from, to, segments = 28, bend = 0.0018) {
  const [lat1, lng1] = from;
  const [lat2, lng2] = to;
  const midLat = (lat1 + lat2) / 2 + bend;
  const midLng = (lng1 + lng2) / 2 - bend * 0.6;
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const u = 1 - t;
    const lat = u * u * lat1 + 2 * u * t * midLat + t * t * lat2;
    const lng = u * u * lng1 + 2 * u * t * midLng + t * t * lng2;
    pts.push([lat, lng]);
  }
  return pts;
}

export function resolveFlowRoutes(assets, flows, loadKw = 0) {
  return flows
    .map((route) => {
      const from = assets.find((a) => a.id === route.from);
      const to = assets.find((a) => a.id === route.to);
    if (!from || !to) return null;
    const coords = bezierPath([from.lat, from.lng], [to.lat, to.lng]);
    const loadFactor = clamp(loadKw / 200, 0.4, 2.2);
    return {
      ...route,
      coords,
      loadFactor,
      style: FLOW_STYLE[route.kind] ?? FLOW_STYLE.grid,
    };
  }).filter(Boolean);
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/** Grid-cell clustering when zoomed out */
export function clusterAssets(assets, zoom) {
  if (zoom >= 14) {
    return assets.map((asset) => ({ kind: "asset", asset }));
  }

  const cell = zoom >= 12 ? 0.004 : 0.008;
  const buckets = new Map();

  for (const asset of assets) {
    const key = `${Math.round(asset.lat / cell)}_${Math.round(asset.lng / cell)}_${asset.type}`;
    if (!buckets.has(key)) {
      buckets.set(key, { assets: [], lat: 0, lng: 0, type: asset.type });
    }
    const b = buckets.get(key);
    b.assets.push(asset);
    b.lat += asset.lat;
    b.lng += asset.lng;
  }

  return [...buckets.values()].map((b) => {
    const n = b.assets.length;
    if (n === 1) return { kind: "asset", asset: b.assets[0] };
    return {
      kind: "cluster",
      id: `cluster-${b.type}-${Math.round(b.lat / n / cell)}`,
      lat: b.lat / n,
      lng: b.lng / n,
      count: n,
      type: b.type,
      assets: b.assets,
    };
  });
}

/** Heatmap points [lat, lng, intensity] for leaflet.heat */
export function buildHeatPoints(assets, stress = 0) {
  const base = stress * 0.6;
  return assets
    .filter((a) => a.type === "substation" || a.type === "utility" || a.type === "building")
    .map((a) => {
      const local = a.status === "critical" ? 1 : a.status === "warning" ? 0.65 : 0.35;
      return [a.lat, a.lng, base + local * 0.4];
    });
}

/** Particle positions along route (0–1) for animated flow dots */
export function particlePhase(routeId, index, total) {
  return ((Date.now() / 1200 + index / total + routeId.length * 0.07) % 1);
}

export function pointAlongPath(coords, t) {
  if (!coords?.length) return null;
  const idx = Math.min(coords.length - 1, Math.floor(t * (coords.length - 1)));
  return coords[idx];
}

export const ASSET_FILTER_TYPES = Object.freeze([
  { id: "ev_charger", label: "EV Chargers" },
  { id: "substation", label: "Substations" },
  { id: "solar", label: "Renewables" },
  { id: "battery", label: "Batteries" },
  { id: "building", label: "Buildings" },
  { id: "utility", label: "Grid Nodes" },
]);
