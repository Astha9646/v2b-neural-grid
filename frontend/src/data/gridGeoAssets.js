/**
 * Grid geo assets — delegates to city presets for real-world layouts.
 */

import {
  CITY_PRESETS,
  DEFAULT_CITY_ID,
  getCityPreset,
} from "./cityPresets";

export { getCityPreset, DEFAULT_CITY_ID };

const defaultCity = getCityPreset(DEFAULT_CITY_ID);

export const GRID_MAP_CENTER = Object.freeze({ ...defaultCity.center });

export const GRID_GEO_ASSETS = defaultCity.assets;
export const GRID_FLOW_ROUTES = defaultCity.flows;

export const FLOW_COLORS = Object.freeze({
  renewable: "#fbbf24",
  grid: "#22d3ee",
  discharge: "#a78bfa",
  v2b: "#38bdf8",
  balance: "#94a3b8",
});

export const ASSET_COLORS = Object.freeze({
  ev_charger: "#38bdf8",
  solar: "#fbbf24",
  building: "#94a3b8",
  battery: "#a78bfa",
  utility: "#22d3ee",
  substation: "#f97316",
});

export function assetById(id, assets = GRID_GEO_ASSETS) {
  return assets.find((a) => a.id === id);
}

export function routesWithCoords(assets = GRID_GEO_ASSETS, flows = GRID_FLOW_ROUTES) {
  return flows
    .map((route) => {
      const from = assetById(route.from, assets);
      const to = assetById(route.to, assets);
      if (!from || !to) return null;
      return {
        ...route,
        coords: [
          [from.lat, from.lng],
          [to.lat, to.lng],
        ],
      };
    })
    .filter(Boolean);
}

export function getAssetsForCity(cityId) {
  return getCityPreset(cityId).assets;
}

export function getFlowsForCity(cityId) {
  return getCityPreset(cityId).flows;
}

export function getCenterForCity(cityId) {
  return getCityPreset(cityId).center;
}
