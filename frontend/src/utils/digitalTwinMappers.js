/**
 * Build digital-twin scene graph from WebSocket telemetry + AI + forecast streams.
 */

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/** Topology anchor positions (normalized 0–1 canvas space). */
export const TWIN_TOPOLOGY = Object.freeze({
  solar: { x: 0.1, y: 0.14 },
  grid: { x: 0.9, y: 0.14 },
  building: { x: 0.5, y: 0.3 },
  battery: { x: 0.5, y: 0.5 },
  chargers: { x: 0.22, y: 0.74 },
  v2b: { x: 0.78, y: 0.74 },
  substation: { x: 0.5, y: 0.14 },
});

const FLOW_DEFS = [
  { id: "solar-building", from: "solar", to: "building", kind: "renewable" },
  { id: "grid-building", from: "grid", to: "building", kind: "grid" },
  { id: "grid-chargers", from: "grid", to: "chargers", kind: "grid" },
  { id: "building-battery", from: "building", to: "battery", kind: "balance" },
  { id: "battery-chargers", from: "battery", to: "chargers", kind: "discharge" },
  { id: "chargers-v2b", from: "chargers", to: "v2b", kind: "fleet" },
  { id: "v2b-grid", from: "v2b", to: "grid", kind: "v2b" },
  { id: "solar-chargers", from: "solar", to: "chargers", kind: "renewable" },
];

const FLOW_COLORS = {
  renewable: "#34d399",
  grid: "#22d3ee",
  balance: "#94a3b8",
  discharge: "#a78bfa",
  fleet: "#c084fc",
  v2b: "#f472b6",
};

/**
 * @param {object} params
 */
export function buildDigitalTwinScene({
  latest = null,
  fleet = [],
  inference = null,
  forecast = null,
} = {}) {
  const row = latest ?? {};
  const stress = clamp(num(row.grid_stress_index), 0, 1.2);
  const renewable = clamp(num(row.renewable_ratio), 0, 1);
  const thermal = num(row.thermal_index, 30);
  const util = clamp(num(row.charger_utilization), 0, 1);
  const load = num(row.grid_load_kw);
  const charging = num(row.charging_power_kw);
  const solar = num(row.solar_generation_kw);
  const soc = clamp(num(row.soc_percent), 0, 100);
  const anomaly = num(row.anomaly_score);

  const gridImport = Math.max(0, load - solar * 0.55);
  const v2bExport = charging < -2 ? Math.abs(charging) : Math.max(0, stress > 0.55 ? load * 0.08 : 0);

  const nodes = [
    {
      id: "solar",
      type: "renewable",
      label: "Solar Array",
      ...TWIN_TOPOLOGY.solar,
      kw: solar,
      soc: null,
      stress: renewable > 0.35 ? 0.15 : 0.4,
      saturation: renewable,
      thermal: 25,
    },
    {
      id: "grid",
      type: "grid",
      label: "Utility Grid",
      ...TWIN_TOPOLOGY.grid,
      kw: gridImport,
      stress,
      saturation: stress,
      thermal: 28,
    },
    {
      id: "building",
      type: "building",
      label: "Smart Building",
      ...TWIN_TOPOLOGY.building,
      kw: load * 0.42,
      stress: stress * 0.9,
      saturation: util * 0.5,
      thermal: thermal * 0.85,
    },
    {
      id: "battery",
      type: "battery",
      label: "BESS / Fleet SOC",
      ...TWIN_TOPOLOGY.battery,
      kw: charging * 0.25,
      soc,
      stress: clamp(Math.abs(soc - 85) / 40, 0, 1),
      saturation: 0,
      thermal: thermal,
    },
    {
      id: "chargers",
      type: "charger",
      label: "Charge Hub",
      ...TWIN_TOPOLOGY.chargers,
      kw: Math.max(charging, 0),
      stress: util,
      saturation: util,
      thermal: thermal,
    },
    {
      id: "v2b",
      type: "v2b",
      label: "V2B Export",
      ...TWIN_TOPOLOGY.v2b,
      kw: v2bExport,
      stress: stress > 0.6 ? stress : 0.2,
      saturation: stress,
      thermal: thermal * 0.9,
    },
  ];

  const flows = FLOW_DEFS.map((def) => {
    const fromNode = nodes.find((n) => n.id === def.from);
    const toNode = nodes.find((n) => n.id === def.to);
    let kw = 0;
    if (def.id === "solar-building") kw = solar * 0.7;
    else if (def.id === "grid-building") kw = gridImport * 0.5;
    else if (def.id === "grid-chargers") kw = Math.max(charging, 0) * 0.6;
    else if (def.id === "building-battery") kw = Math.abs(charging) * 0.2;
    else if (def.id === "battery-chargers") kw = soc > 70 ? charging * 0.15 : 0;
    else if (def.id === "chargers-v2b") kw = Math.max(charging, 0) * 0.35;
    else if (def.id === "v2b-grid") kw = v2bExport;
    else if (def.id === "solar-chargers") kw = solar * 0.3;

    return {
      ...def,
      from: fromNode,
      to: toNode,
      kw: Math.max(0, kw),
      color: FLOW_COLORS[def.kind] ?? "#22d3ee",
      active: kw > 0.5,
    };
  }).filter((f) => f.from && f.to);

  const fleetList = Array.isArray(fleet) ? fleet : [];
  const evNodes = layoutEvFleet(fleetList, TWIN_TOPOLOGY.chargers, TWIN_TOPOLOGY.v2b);

  const zones = buildStressZones(nodes, row, util, stress, thermal, renewable);

  const aiOverlays = buildAiOverlays(inference, nodes, flows);

  const metrics = {
    loadKw: load,
    chargingKw: charging,
    stressPct: Math.round(stress * 100),
    renewablePct: Math.round(renewable * 100),
    socPct: Math.round(soc),
    thermalC: thermal.toFixed(1),
    utilPct: Math.round(util * 100),
    anomaly: anomaly.toFixed(2),
    forecastPeak: forecast?.peakPrediction?.predictedPeakKw ?? null,
    policySource: inference?.policy_source ?? "—",
    optimization: inference?.optimization_action ?? "steady_state",
  };

  return {
    nodes,
    flows,
    evNodes,
    zones,
    aiOverlays,
    metrics,
    timestamp: row.timestamp ?? null,
  };
}

function layoutEvFleet(fleet, chargerAnchor, v2bAnchor) {
  const count = Math.max(fleet.length, 8);
  const items = fleet.length ? fleet : Array.from({ length: 8 }, (_, i) => ({
    evId: `EV-${i + 1}`,
    soc: 50 + i * 3,
    power: 0,
    fleetStatus: "Idle",
  }));

  return items.slice(0, 8).map((ev, i) => {
    const angle = Math.PI * 0.15 + (i / Math.max(count - 1, 1)) * Math.PI * 0.7;
    const radius = 0.12;
    const anchor = i < 4 ? chargerAnchor : v2bAnchor;
    const offset = i < 4 ? i : i - 4;
    const a = angle + (offset - 1.5) * 0.22;

    return {
      id: ev.evId ?? `EV-${i + 1}`,
      x: anchor.x + Math.cos(a) * radius,
      y: anchor.y + Math.sin(a) * radius * 0.6,
      soc: num(ev.soc, 50),
      power: num(ev.power, 0),
      status: ev.fleetStatus ?? ev.chargingState ?? "idle",
      stress: num(ev.chargingStress, 40) / 100,
      thermal: ev.thermalStatus ?? "normal",
    };
  });
}

function buildStressZones(nodes, row, util, stress, thermal, renewable) {
  const zones = [];

  if (stress > 0.45) {
    zones.push({
      id: "grid-congestion",
      x: 0.5,
      y: 0.22,
      radius: 0.18 + stress * 0.08,
      intensity: stress,
      type: "overload",
      label: "Grid congestion",
    });
  }

  if (util > 0.7) {
    zones.push({
      id: "charger-saturation",
      x: TWIN_TOPOLOGY.chargers.x,
      y: TWIN_TOPOLOGY.chargers.y,
      radius: 0.14 + util * 0.06,
      intensity: util,
      type: "saturation",
      label: "Charger saturation",
    });
  }

  if (thermal >= 38) {
    zones.push({
      id: "thermal-hotspot",
      x: TWIN_TOPOLOGY.battery.x,
      y: TWIN_TOPOLOGY.battery.y,
      radius: 0.12,
      intensity: clamp((thermal - 35) / 12, 0.3, 1),
      type: "thermal",
      label: `Thermal ${thermal.toFixed(0)}°C`,
    });
  }

  if (renewable > 0.35) {
    zones.push({
      id: "renewable-rich",
      x: TWIN_TOPOLOGY.solar.x,
      y: TWIN_TOPOLOGY.solar.y,
      radius: 0.16,
      intensity: renewable,
      type: "renewable",
      label: "Renewable-rich zone",
    });
  }

  if (num(row.anomaly_score) > 1.5) {
    zones.push({
      id: "anomaly",
      x: TWIN_TOPOLOGY.building.x,
      y: TWIN_TOPOLOGY.building.y,
      radius: 0.1,
      intensity: clamp(num(row.anomaly_score) / 5, 0.4, 1),
      type: "anomaly",
      label: "Anomaly detected",
    });
  }

  return zones;
}

function buildAiOverlays(inference, nodes, flows) {
  if (!inference) return [];

  const overlays = [];
  const actions = inference.ddpg_actions ?? inference.explainability?.action_interpretations ?? [];
  const actionList = Array.isArray(actions)
    ? actions
    : typeof actions === "object"
      ? Object.entries(actions).map(([action, value]) => ({
          action,
          value,
          interpretation: `${action}: ${value}`,
        }))
      : [];

  const chargers = nodes.find((n) => n.id === "chargers");
  const grid = nodes.find((n) => n.id === "grid");
  const battery = nodes.find((n) => n.id === "battery");

  if (inference.peak_shaving_action) {
    overlays.push({
      id: "peak-shave",
      from: grid,
      to: chargers,
      label: "Peak shave",
      action: inference.peak_shaving_action,
      color: "#f97316",
    });
  }

  if (inference.battery_protection_action && battery && chargers) {
    overlays.push({
      id: "battery-guard",
      from: battery,
      to: chargers,
      label: "Battery protection",
      action: inference.battery_protection_action,
      color: "#34d399",
    });
  }

  const chargingAdj = actionList.find((a) => a.action === "charging_rate_adjustment");
  if (chargingAdj && Number(chargingAdj.value) < -0.2) {
    overlays.push({
      id: "reduce-charge",
      from: grid,
      to: chargers,
      label: "Reduce charging",
      action: chargingAdj.interpretation ?? "Load reduction",
      color: "#22d3ee",
    });
  }

  const renewableAlloc = actionList.find((a) => a.action === "renewable_allocation");
  if (renewableAlloc && Number(renewableAlloc.value) > 0.15) {
    const solar = nodes.find((n) => n.id === "solar");
    overlays.push({
      id: "renewable-dispatch",
      from: solar,
      to: nodes.find((n) => n.id === "building"),
      label: "Renewable dispatch",
      action: renewableAlloc.interpretation ?? "Solar priority",
      color: "#34d399",
    });
  }

  return overlays.filter((o) => o.from && o.to);
}

export function emptyTwinScene() {
  return buildDigitalTwinScene({});
}
