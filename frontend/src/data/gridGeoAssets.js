/**
 * Simulated smart-grid geographic assets (Pasadena / Caltech-scale campus grid).
 * Coordinates are static; live status comes from WebSocket telemetry sync.
 */

export const GRID_MAP_CENTER = Object.freeze({
  lat: 34.1377,
  lng: -118.1253,
  zoom: 14,
});

/** @typedef {'ev_charger'|'solar'|'building'|'battery'|'utility'|'substation'} GridAssetType */

/**
 * @typedef {Object} GridGeoAsset
 * @property {string} id
 * @property {GridAssetType} type
 * @property {string} label
 * @property {number} lat
 * @property {number} lng
 * @property {string} [fleetId]
 * @property {number} [capacityKw]
 */

/** @type {GridGeoAsset[]} */
export const GRID_GEO_ASSETS = [
  { id: "sub-1", type: "substation", label: "Main Substation", lat: 34.1412, lng: -118.1288, capacityKw: 380 },
  { id: "util-1", type: "utility", label: "Grid Node Alpha", lat: 34.1395, lng: -118.1310, capacityKw: 220 },
  { id: "util-2", type: "utility", label: "Grid Node Beta", lat: 34.1358, lng: -118.1195, capacityKw: 180 },
  { id: "solar-1", type: "solar", label: "Solar Array North", lat: 34.1405, lng: -118.1220, capacityKw: 120 },
  { id: "solar-2", type: "solar", label: "Solar Array East", lat: 34.1362, lng: -118.1275, capacityKw: 85 },
  { id: "bld-1", type: "building", label: "Research Tower", lat: 34.1388, lng: -118.1250, capacityKw: 95 },
  { id: "bld-2", type: "building", label: "Operations Center", lat: 34.1365, lng: -118.1238, capacityKw: 110 },
  { id: "bat-1", type: "battery", label: "BESS Alpha", lat: 34.1370, lng: -118.1265, capacityKw: 200 },
  { id: "bat-2", type: "battery", label: "BESS Beta", lat: 34.1390, lng: -118.1205, capacityKw: 150 },
  { id: "ev-1", type: "ev_charger", label: "Hub A — L2", lat: 34.1382, lng: -118.1242, fleetId: "EV-01", capacityKw: 50 },
  { id: "ev-2", type: "ev_charger", label: "Hub B — DCFC", lat: 34.1375, lng: -118.1270, fleetId: "EV-02", capacityKw: 150 },
  { id: "ev-3", type: "ev_charger", label: "Hub C — Fleet", lat: 34.1368, lng: -118.1218, fleetId: "EV-03", capacityKw: 75 },
  { id: "ev-4", type: "ev_charger", label: "Hub D — V2B", lat: 34.1398, lng: -118.1260, fleetId: "EV-04", capacityKw: 60 },
];

/** Power flow routes between asset ids */
export const GRID_FLOW_ROUTES = Object.freeze([
  { id: "flow-solar-bld", from: "solar-1", to: "bld-1", kind: "renewable" },
  { id: "flow-solar-ev", from: "solar-2", to: "ev-2", kind: "renewable" },
  { id: "flow-grid-sub", from: "util-1", to: "sub-1", kind: "grid" },
  { id: "flow-sub-bld", from: "sub-1", to: "bld-2", kind: "grid" },
  { id: "flow-bat-ev", from: "bat-1", to: "ev-1", kind: "discharge" },
  { id: "flow-ev-grid", from: "ev-4", to: "util-2", kind: "v2b" },
  { id: "flow-solar-bat", from: "solar-1", to: "bat-2", kind: "renewable" },
]);

export const FLOW_COLORS = Object.freeze({
  renewable: "#34d399",
  grid: "#22d3ee",
  discharge: "#a78bfa",
  v2b: "#f472b6",
  balance: "#94a3b8",
});

export const ASSET_COLORS = Object.freeze({
  ev_charger: "#22d3ee",
  solar: "#34d399",
  building: "#94a3b8",
  battery: "#a78bfa",
  utility: "#fbbf24",
  substation: "#f97316",
});

export function assetById(id) {
  return GRID_GEO_ASSETS.find((a) => a.id === id);
}

export function routesWithCoords() {
  return GRID_FLOW_ROUTES.map((route) => {
    const from = assetById(route.from);
    const to = assetById(route.to);
    if (!from || !to) return null;
    return {
      ...route,
      coords: [
        [from.lat, from.lng],
        [to.lat, to.lng],
      ],
    };
  }).filter(Boolean);
}
