/**
 * Cinematic smart-city layout — fixed zones for clarity (not geo-scattered cubes).
 * CENTER: buildings | LEFT: solar | RIGHT: utility | BOTTOM: EV | MID: battery
 */

export const SCENE_ZONES = Object.freeze({
  center: { x: 0, z: 0 },
  solar: { x: -14, z: -2 },
  utility: { x: 14, z: -1 },
  ev: { x: 0, z: 12 },
  battery: { x: 0, z: -4 },
});

/** Map asset ids to deliberate scene positions */
export const ASSET_SCENE_POS = Object.freeze({
  "bld-1": [0, 0, -2],
  "bld-2": [2.5, 0, 1],
  "solar-1": [-14, 0, -3],
  "solar-2": [-12, 0, 2],
  "sub-1": [14, 0, -4],
  "util-1": [16, 0, 0],
  "util-2": [12, 0, 4],
  "bat-1": [-2, 0, -5],
  "bat-2": [2, 0, -6],
  "ev-1": [-4, 0, 12],
  "ev-2": [0, 0, 13],
  "ev-3": [4, 0, 12],
  "ev-4": [0, 0, 10],
});

export const ENERGY_PATHS = Object.freeze([
  { from: "solar-1", to: "bld-1", kind: "renewable", color: "#fbbf24" },
  { from: "solar-2", to: "bat-1", kind: "renewable", color: "#fbbf24" },
  { from: "bat-1", to: "ev-2", kind: "discharge", color: "#a78bfa" },
  { from: "sub-1", to: "bld-2", kind: "grid", color: "#38bdf8" },
  { from: "ev-4", to: "util-2", kind: "v2b", color: "#22d3ee" },
  { from: "util-1", to: "sub-1", kind: "grid", color: "#38bdf8" },
]);

export const ROAD_PATHS = Object.freeze([
  [[-8, 0.02, 8], [8, 0.02, 8]],
  [[0, 0.02, -8], [0, 0.02, 14]],
  [[-10, 0.02, 0], [10, 0.02, 0]],
]);

export function getScenePosition(assetId) {
  return ASSET_SCENE_POS[assetId] ?? [0, 0, 0];
}

export function getFocusCameraTarget(assetId) {
  const [x, , z] = getScenePosition(assetId);
  return {
    position: [x + 4, 6, z + 10],
    lookAt: [x, 1.5, z],
  };
}
