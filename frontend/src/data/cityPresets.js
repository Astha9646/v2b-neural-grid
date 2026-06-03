/**
 * Real-world city presets with geospatial smart-grid asset layouts.
 * Coordinates anchor to known urban districts; telemetry remains simulated.
 */

const mkAssets = (center, layout) =>
  layout.map((item) => ({
    ...item,
    lat: center.lat + item.dLat,
    lng: center.lng + item.dLng,
  }));

const mkFlows = (flows) => flows;

/** @typedef {'bangalore'|'mumbai'|'delhi'|'san_francisco'} CityId */

export const CITY_IDS = Object.freeze(["bangalore", "mumbai", "delhi", "san_francisco"]);

export const CITY_PRESETS = Object.freeze({
  bangalore: {
    id: "bangalore",
    name: "Bangalore",
    region: "India · Tech Corridor",
    center: { lat: 12.9716, lng: 77.5946, zoom: 13 },
    assets: mkAssets(
      { lat: 12.9716, lng: 77.5946 },
      [
        { id: "sub-1", type: "substation", label: "MG Road Substation", dLat: 0.012, dLng: -0.008, capacityKw: 420 },
        { id: "util-1", type: "utility", label: "Indiranagar Grid Node", dLat: 0.008, dLng: 0.014, capacityKw: 240 },
        { id: "util-2", type: "utility", label: "Koramangala Node", dLat: -0.011, dLng: 0.006, capacityKw: 190 },
        { id: "solar-1", type: "solar", label: "Whitefield Solar Farm", dLat: 0.018, dLng: 0.022, capacityKw: 140 },
        { id: "solar-2", type: "solar", label: "Electronic City Array", dLat: -0.022, dLng: 0.018, capacityKw: 95 },
        { id: "bld-1", type: "building", label: "Manyata Tech Park", dLat: 0.006, dLng: -0.004, capacityKw: 110 },
        { id: "bld-2", type: "building", label: "UB City Operations", dLat: -0.004, dLng: -0.006, capacityKw: 125 },
        { id: "bat-1", type: "battery", label: "BESS Koramangala", dLat: -0.009, dLng: 0.003, capacityKw: 220 },
        { id: "bat-2", type: "battery", label: "BESS HSR Layout", dLat: 0.003, dLng: 0.009, capacityKw: 160 },
        { id: "ev-1", type: "ev_charger", label: "Hub — MG Road L2", dLat: 0.002, dLng: -0.002, fleetId: "EV-01", capacityKw: 55 },
        { id: "ev-2", type: "ev_charger", label: "Hub — Indiranagar DCFC", dLat: 0.007, dLng: 0.011, fleetId: "EV-02", capacityKw: 150 },
        { id: "ev-3", type: "ev_charger", label: "Hub — Koramangala Fleet", dLat: -0.008, dLng: 0.005, fleetId: "EV-03", capacityKw: 80 },
        { id: "ev-4", type: "ev_charger", label: "Hub — V2G Brigade Road", dLat: 0.005, dLng: -0.005, fleetId: "EV-04", capacityKw: 65 },
      ],
    ),
    flows: mkFlows([
      { id: "flow-solar-bld", from: "solar-1", to: "bld-1", kind: "renewable" },
      { id: "flow-solar-ev", from: "solar-2", to: "ev-2", kind: "renewable" },
      { id: "flow-grid-sub", from: "util-1", to: "sub-1", kind: "grid" },
      { id: "flow-sub-bld", from: "sub-1", to: "bld-2", kind: "grid" },
      { id: "flow-bat-ev", from: "bat-1", to: "ev-1", kind: "discharge" },
      { id: "flow-ev-grid", from: "ev-4", to: "util-2", kind: "v2b" },
      { id: "flow-solar-bat", from: "solar-1", to: "bat-2", kind: "renewable" },
    ]),
  },

  mumbai: {
    id: "mumbai",
    name: "Mumbai",
    region: "India · Coastal Grid",
    center: { lat: 19.076, lng: 72.8777, zoom: 13 },
    assets: mkAssets(
      { lat: 19.076, lng: 72.8777 },
      [
        { id: "sub-1", type: "substation", label: "Bandra Substation", dLat: 0.014, dLng: -0.012, capacityKw: 450 },
        { id: "util-1", type: "utility", label: "Andheri Grid Node", dLat: 0.018, dLng: 0.008, capacityKw: 260 },
        { id: "util-2", type: "utility", label: "Lower Parel Node", dLat: -0.008, dLng: -0.005, capacityKw: 200 },
        { id: "solar-1", type: "solar", label: "Navi Mumbai Solar", dLat: -0.025, dLng: 0.02, capacityKw: 130 },
        { id: "solar-2", type: "solar", label: "Powai Rooftop Array", dLat: 0.012, dLng: 0.016, capacityKw: 88 },
        { id: "bld-1", type: "building", label: "BKC Finance Tower", dLat: -0.006, dLng: 0.01, capacityKw: 140 },
        { id: "bld-2", type: "building", label: "Nariman Point Ops", dLat: -0.015, dLng: -0.008, capacityKw: 115 },
        { id: "bat-1", type: "battery", label: "BESS Worli", dLat: -0.004, dLng: 0.002, capacityKw: 210 },
        { id: "bat-2", type: "battery", label: "BESS Colaba", dLat: -0.018, dLng: -0.003, capacityKw: 155 },
        { id: "ev-1", type: "ev_charger", label: "Hub — Bandra L2", dLat: 0.011, dLng: -0.009, fleetId: "EV-01", capacityKw: 50 },
        { id: "ev-2", type: "ev_charger", label: "Hub — Andheri DCFC", dLat: 0.016, dLng: 0.007, fleetId: "EV-02", capacityKw: 160 },
        { id: "ev-3", type: "ev_charger", label: "Hub — BKC Fleet", dLat: -0.005, dLng: 0.009, fleetId: "EV-03", capacityKw: 78 },
        { id: "ev-4", type: "ev_charger", label: "Hub — V2G Marine Drive", dLat: -0.012, dLng: -0.006, fleetId: "EV-04", capacityKw: 62 },
      ],
    ),
    flows: mkFlows([
      { id: "flow-solar-bld", from: "solar-1", to: "bld-1", kind: "renewable" },
      { id: "flow-solar-ev", from: "solar-2", to: "ev-2", kind: "renewable" },
      { id: "flow-grid-sub", from: "util-1", to: "sub-1", kind: "grid" },
      { id: "flow-sub-bld", from: "sub-1", to: "bld-2", kind: "grid" },
      { id: "flow-bat-ev", from: "bat-1", to: "ev-1", kind: "discharge" },
      { id: "flow-ev-grid", from: "ev-4", to: "util-2", kind: "v2b" },
      { id: "flow-solar-bat", from: "solar-1", to: "bat-2", kind: "renewable" },
    ]),
  },

  delhi: {
    id: "delhi",
    name: "Delhi",
    region: "India · Capital Grid",
    center: { lat: 28.6139, lng: 77.209, zoom: 13 },
    assets: mkAssets(
      { lat: 28.6139, lng: 77.209 },
      [
        { id: "sub-1", type: "substation", label: "Connaught Place Sub", dLat: 0.006, dLng: -0.005, capacityKw: 400 },
        { id: "util-1", type: "utility", label: "Noida Grid Node", dLat: 0.02, dLng: 0.025, capacityKw: 230 },
        { id: "util-2", type: "utility", label: "Gurgaon Node", dLat: -0.018, dLng: -0.022, capacityKw: 195 },
        { id: "solar-1", type: "solar", label: "Dwarka Solar Park", dLat: -0.022, dLng: -0.015, capacityKw: 125 },
        { id: "solar-2", type: "solar", label: "Aerocity Array", dLat: -0.012, dLng: -0.018, capacityKw: 90 },
        { id: "bld-1", type: "building", label: "Cyber Hub Tower", dLat: -0.015, dLng: -0.02, capacityKw: 105 },
        { id: "bld-2", type: "building", label: "CP Operations Center", dLat: 0.004, dLng: -0.003, capacityKw: 120 },
        { id: "bat-1", type: "battery", label: "BESS Saket", dLat: -0.008, dLng: 0.008, capacityKw: 205 },
        { id: "bat-2", type: "battery", label: "BESS Lajpat Nagar", dLat: -0.01, dLng: 0.004, capacityKw: 148 },
        { id: "ev-1", type: "ev_charger", label: "Hub — CP L2", dLat: 0.003, dLng: -0.002, fleetId: "EV-01", capacityKw: 52 },
        { id: "ev-2", type: "ev_charger", label: "Hub — Noida DCFC", dLat: 0.018, dLng: 0.022, fleetId: "EV-02", capacityKw: 155 },
        { id: "ev-3", type: "ev_charger", label: "Hub — Gurgaon Fleet", dLat: -0.016, dLng: -0.02, fleetId: "EV-03", capacityKw: 72 },
        { id: "ev-4", type: "ev_charger", label: "Hub — V2G IGI Corridor", dLat: -0.014, dLng: -0.01, fleetId: "EV-04", capacityKw: 58 },
      ],
    ),
    flows: mkFlows([
      { id: "flow-solar-bld", from: "solar-1", to: "bld-1", kind: "renewable" },
      { id: "flow-solar-ev", from: "solar-2", to: "ev-2", kind: "renewable" },
      { id: "flow-grid-sub", from: "util-1", to: "sub-1", kind: "grid" },
      { id: "flow-sub-bld", from: "sub-1", to: "bld-2", kind: "grid" },
      { id: "flow-bat-ev", from: "bat-1", to: "ev-1", kind: "discharge" },
      { id: "flow-ev-grid", from: "ev-4", to: "util-2", kind: "v2b" },
      { id: "flow-solar-bat", from: "solar-1", to: "bat-2", kind: "renewable" },
    ]),
  },

  san_francisco: {
    id: "san_francisco",
    name: "San Francisco",
    region: "USA · Bay Area",
    center: { lat: 37.7749, lng: -122.4194, zoom: 13 },
    assets: mkAssets(
      { lat: 37.7749, lng: -122.4194 },
      [
        { id: "sub-1", type: "substation", label: "Mission Substation", dLat: 0.012, dLng: -0.01, capacityKw: 380 },
        { id: "util-1", type: "utility", label: "SOMA Grid Node", dLat: 0.006, dLng: 0.008, capacityKw: 225 },
        { id: "util-2", type: "utility", label: "Sunset Node", dLat: 0.008, dLng: -0.018, capacityKw: 185 },
        { id: "solar-1", type: "solar", label: "Bayview Solar Farm", dLat: -0.018, dLng: 0.012, capacityKw: 118 },
        { id: "solar-2", type: "solar", label: "Presidio Array", dLat: 0.016, dLng: -0.014, capacityKw: 82 },
        { id: "bld-1", type: "building", label: "Salesforce Tower Grid", dLat: 0.004, dLng: 0.005, capacityKw: 98 },
        { id: "bld-2", type: "building", label: "Market Street Ops", dLat: 0.002, dLng: -0.003, capacityKw: 112 },
        { id: "bat-1", type: "battery", label: "BESS Embarcadero", dLat: 0.005, dLng: 0.002, capacityKw: 198 },
        { id: "bat-2", type: "battery", label: "BESS Castro", dLat: 0.009, dLng: -0.006, capacityKw: 152 },
        { id: "ev-1", type: "ev_charger", label: "Hub — SOMA L2", dLat: 0.005, dLng: 0.006, fleetId: "EV-01", capacityKw: 48 },
        { id: "ev-2", type: "ev_charger", label: "Hub — Pier DCFC", dLat: 0.003, dLng: 0.012, fleetId: "EV-02", capacityKw: 145 },
        { id: "ev-3", type: "ev_charger", label: "Hub — Mission Fleet", dLat: 0.01, dLng: -0.008, fleetId: "EV-03", capacityKw: 70 },
        { id: "ev-4", type: "ev_charger", label: "Hub — V2G Financial", dLat: 0.001, dLng: 0.004, fleetId: "EV-04", capacityKw: 58 },
      ],
    ),
    flows: mkFlows([
      { id: "flow-solar-bld", from: "solar-1", to: "bld-1", kind: "renewable" },
      { id: "flow-solar-ev", from: "solar-2", to: "ev-2", kind: "renewable" },
      { id: "flow-grid-sub", from: "util-1", to: "sub-1", kind: "grid" },
      { id: "flow-sub-bld", from: "sub-1", to: "bld-2", kind: "grid" },
      { id: "flow-bat-ev", from: "bat-1", to: "ev-1", kind: "discharge" },
      { id: "flow-ev-grid", from: "ev-4", to: "util-2", kind: "v2b" },
      { id: "flow-solar-bat", from: "solar-1", to: "bat-2", kind: "renewable" },
    ]),
  },
});

export const DEFAULT_CITY_ID = "bangalore";

export function getCityPreset(cityId = DEFAULT_CITY_ID) {
  return CITY_PRESETS[cityId] ?? CITY_PRESETS[DEFAULT_CITY_ID];
}

export function getCityList() {
  return CITY_IDS.map((id) => ({
    id,
    name: CITY_PRESETS[id].name,
    region: CITY_PRESETS[id].region,
  }));
}
