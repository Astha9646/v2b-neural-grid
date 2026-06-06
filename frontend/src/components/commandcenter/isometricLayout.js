/** Isometric smart-city layout — structured zoning (not random scatter) */

export const ISO = Object.freeze({ scale: 26, ox: 420, oy: 100 });

export function toIso(gx, gy, gz = 0) {
  const { scale, ox, oy } = ISO;
  return {
    x: ox + (gx - gy) * scale,
    y: oy + (gx + gy) * (scale * 0.52) - gz * scale,
  };
}

/** Zone grid positions — downtown center, solar west, grid east, EV south, BESS core */
export const CITY_ZONES = Object.freeze([
  { id: "downtown", label: "Downtown Core", type: "building", gx: 0, gy: 0, w: 2.2, h: 2, height: 3.8, towers: 3 },
  { id: "solar", label: "Solar Farm", type: "solar", gx: -5.5, gy: -1.5, w: 3, h: 2.2, height: 0.4, panels: 5 },
  { id: "grid", label: "Grid Industrial", type: "substation", gx: 5.5, gy: -1.5, w: 2.4, h: 2, height: 2.8, towers: 2 },
  { id: "battery", label: "BESS Core", type: "battery", gx: 0, gy: -3.8, w: 2, h: 1.4, height: 1.1 },
  { id: "ev", label: "EV District", type: "ev_charger", gx: 0, gy: 5, w: 3.2, h: 2, height: 0.7, bays: 4 },
  { id: "res-a", label: "Residential West", type: "building", gx: -3.2, gy: 3.2, w: 2, h: 1.8, height: 1.6, towers: 2 },
  { id: "res-b", label: "Residential East", type: "building", gx: 3.2, gy: 3.2, w: 2, h: 1.8, height: 1.6, towers: 2 },
]);

export const ENERGY_ROUTES = Object.freeze([
  { id: "r-solar-dt", from: "solar", to: "downtown", kind: "solar" },
  { id: "r-grid-ev", from: "grid", to: "ev", kind: "grid" },
  { id: "r-bat-grid", from: "battery", to: "grid", kind: "battery" },
  { id: "r-ev-res", from: "ev", to: "res-a", kind: "v2g" },
  { id: "r-solar-bat", from: "solar", to: "battery", kind: "solar" },
  { id: "r-grid-dt", from: "grid", to: "downtown", kind: "grid" },
]);

export const ROUTE_COLORS = Object.freeze({
  solar: { stroke: "#fbbf24", glow: "#fcd34d", particle: "#fde68a" },
  grid: { stroke: "#38bdf8", glow: "#22d3ee", particle: "#67e8f9" },
  battery: { stroke: "#a78bfa", glow: "#c4b5fd", particle: "#ddd6fe" },
  v2g: { stroke: "#22d3ee", glow: "#06b6d4", particle: "#a5f3fc" },
  stress: { stroke: "#f87171", glow: "#fb923c", particle: "#fca5a5" },
});

export const ROAD_PATHS = Object.freeze([
  { id: "road-h", points: [[-6, 1.5], [6, 1.5]] },
  { id: "road-v", points: [[0, -5], [0, 6.5]] },
  { id: "road-diag", points: [[-4, 4], [4, -2]] },
]);

export function zoneCenter(zone) {
  return toIso(zone.gx + zone.w / 2, zone.gy + zone.h / 2, zone.height * 0.5);
}

export function routePath(fromId, toId, zones = CITY_ZONES) {
  const a = zones.find((z) => z.id === fromId);
  const b = zones.find((z) => z.id === toId);
  if (!a || !b) return "";
  const p1 = zoneCenter(a);
  const p2 = zoneCenter(b);
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2 - 28;
  return `M ${p1.x} ${p1.y} Q ${mx} ${my} ${p2.x} ${p2.y}`;
}

export function zoneById(id) {
  return CITY_ZONES.find((z) => z.id === id);
}

/** Isometric footprint corners for a zone block */
export function zoneFootprint(zone) {
  const { gx, gy, w, h } = zone;
  const a = toIso(gx, gy, 0);
  const b = toIso(gx + w, gy, 0);
  const c = toIso(gx + w, gy + h, 0);
  const d = toIso(gx, gy + h, 0);
  return `${a.x},${a.y} ${b.x},${b.y} ${c.x},${c.y} ${d.x},${d.y}`;
}
