import L from "leaflet";

import { ASSET_COLORS } from "../../data/gridGeoAssets";

const STATUS_RING = {
  ok: "#34d399",
  idle: "#64748b",
  warning: "#fbbf24",
  critical: "#f87171",
};

/** Inline SVG icons per asset type — premium neon markers */
const SVG = {
  ev_charger: (c) =>
    `<svg viewBox="0 0 32 32" width="32" height="32"><circle cx="16" cy="16" r="14" fill="${c}18" stroke="${c}" stroke-width="1.5"/><path d="M18 8L12 17h4l-2 9 8-12h-4l2-6z" fill="${c}" stroke="#fff" stroke-width="0.5" opacity="0.95"/></svg>`,
  solar: (c) =>
    `<svg viewBox="0 0 32 32" width="32" height="32"><circle cx="16" cy="16" r="14" fill="${c}18" stroke="${c}" stroke-width="1.5"/><rect x="8" y="14" width="16" height="8" rx="1" fill="${c}" opacity="0.85"/><path d="M10 14l6-5 6 5" stroke="${c}" stroke-width="1.2" fill="none"/></svg>`,
  battery: (c) =>
    `<svg viewBox="0 0 32 32" width="32" height="32"><circle cx="16" cy="16" r="14" fill="${c}18" stroke="${c}" stroke-width="1.5"/><rect x="10" y="11" width="14" height="10" rx="2" fill="none" stroke="${c}" stroke-width="1.5"/><rect x="20" y="14" width="2" height="4" fill="${c}"/><rect x="12" y="14" width="6" height="4" fill="${c}" opacity="0.7"/></svg>`,
  building: (c) =>
    `<svg viewBox="0 0 32 32" width="32" height="32"><circle cx="16" cy="16" r="14" fill="${c}18" stroke="${c}" stroke-width="1.5"/><rect x="11" y="10" width="10" height="14" fill="${c}" opacity="0.5" stroke="${c}" stroke-width="1"/><rect x="13" y="13" width="2" height="2" fill="#fff" opacity="0.6"/><rect x="17" y="13" width="2" height="2" fill="#fff" opacity="0.6"/><rect x="13" y="17" width="2" height="2" fill="#fff" opacity="0.6"/><rect x="17" y="17" width="2" height="2" fill="#fff" opacity="0.6"/></svg>`,
  utility: (c) =>
    `<svg viewBox="0 0 32 32" width="32" height="32"><circle cx="16" cy="16" r="14" fill="${c}18" stroke="${c}" stroke-width="1.5"/><path d="M16 8v16M12 12h8M12 20h8" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/><circle cx="16" cy="16" r="3" fill="${c}"/></svg>`,
  substation: (c) =>
    `<svg viewBox="0 0 32 32" width="32" height="32"><circle cx="16" cy="16" r="14" fill="${c}18" stroke="${c}" stroke-width="1.5"/><path d="M10 22l6-12 6 12M13 18h6" stroke="${c}" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>`,
  cluster: (c, count) =>
    `<svg viewBox="0 0 40 40" width="40" height="40"><circle cx="20" cy="20" r="17" fill="${c}22" stroke="${c}" stroke-width="2"/><text x="20" y="25" text-anchor="middle" fill="${c}" font-size="12" font-weight="700" font-family="system-ui">${count}</text></svg>`,
  alert: (c) =>
    `<svg viewBox="0 0 28 28" width="28" height="28"><circle cx="14" cy="14" r="12" fill="${c}25" stroke="${c}" stroke-width="2"/><text x="14" y="19" text-anchor="middle" fill="${c}" font-size="14" font-weight="800">!</text></svg>`,
};

export function createAssetIcon(asset, { selected = false, live = true } = {}) {
  const color = ASSET_COLORS[asset.type] ?? "#22d3ee";
  const ring = STATUS_RING[asset.status] ?? STATUS_RING.ok;
  const svgFn = SVG[asset.type] ?? SVG.building;
  const pulse = asset.status === "critical" ? "map-marker-pulse" : "";
  const selectedRing = selected ? `box-shadow:0 0 0 3px ${ring},0 0 20px ${color};` : `box-shadow:0 0 14px ${color}88;`;

  return L.divIcon({
    className: `grid-map-marker ${pulse}`,
    html: `<div class="map-marker-wrap" style="${selectedRing}">
      ${svgFn(color)}
      ${live ? '<span class="map-live-dot"></span>' : ""}
      <span class="map-status-ring" style="border-color:${ring}"></span>
    </div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

export function createClusterIcon(count, dominantType) {
  const color = ASSET_COLORS[dominantType] ?? "#22d3ee";
  return L.divIcon({
    className: "grid-map-marker",
    html: `<div class="map-cluster-wrap">${SVG.cluster(color, count)}</div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}

export function createAlertIcon(severity) {
  const color = severity === "critical" ? "#f87171" : severity === "high" ? "#fb923c" : "#fbbf24";
  return L.divIcon({
    className: "grid-map-marker map-marker-pulse",
    html: `<div class="map-alert-wrap">${SVG.alert(color)}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}
