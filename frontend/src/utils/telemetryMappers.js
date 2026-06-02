/**
 * Transform grid_telemetry.csv records into dashboard component schemas.
 */

import { CHART_MAX_POINTS } from "./streamConstants";

function pickTime(row, index) {
  if (row?.time != null && row?.timestamp) {
    const d = new Date(row.timestamp);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    }
  }
  if (row?.time != null) return String(row.time);
  if (row?.timestamp) {
    const d = new Date(row.timestamp);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    }
    return String(row.timestamp).slice(11, 16);
  }
  return `T${index + 1}`;
}

function num(row, key, fallback = 0) {
  const v = Number(row?.[key]);
  return Number.isFinite(v) ? v : fallback;
}

function distributeCharging(total) {
  return {
    chargerA: total * 0.28,
    chargerB: total * 0.24,
    chargerC: total * 0.26,
    chargerD: total * 0.22,
  };
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

export function mapLoadChartData(rows, maxPoints = CHART_MAX_POINTS) {
  if (!Array.isArray(rows)) return [];
  return rows.slice(-maxPoints).map((row, index) => ({
    id: `${row.timestamp ?? index}-${index}`,
    time: pickTime(row, index),
    load: num(row, "grid_load_kw") || num(row, "load") || num(row, "grid_load_kw_ma3"),
    peak: num(row, "peak_demand_kw") || num(row, "grid_load_kw"),
  }));
}

export function mapSocChartData(rows, maxPoints = CHART_MAX_POINTS) {
  if (!Array.isArray(rows)) return [];
  return rows.slice(-maxPoints).map((row, index) => ({
    id: `${row.timestamp ?? index}-${index}`,
    time: pickTime(row, index),
    soc: num(row, "soc_percent") || num(row, "soc"),
  }));
}

export function mapChargingChartData(rows, maxPoints = CHART_MAX_POINTS) {
  if (!Array.isArray(rows)) return [];
  return rows.slice(-maxPoints).map((row, index) => {
    const total = num(row, "charging_power_kw") || num(row, "charging_power_kw_ma3");
    const a = num(row, "chargerA");
    const b = num(row, "chargerB");
    const c = num(row, "chargerC");
    const d = num(row, "chargerD");
    const sumChargers = a + b + c + d;
    const distributed = sumChargers > 0.01 ? { chargerA: a, chargerB: b, chargerC: c, chargerD: d } : distributeCharging(total);

    return {
      id: `${row.timestamp ?? index}-${index}`,
      time: pickTime(row, index),
      ...distributed,
      utilization: num(row, "charger_utilization"),
      chargingPower: total,
    };
  });
}

// ---------------------------------------------------------------------------
// Solar panel
// ---------------------------------------------------------------------------

export function mapSolarPanelData(rows) {
  if (!rows?.length) return null;

  const latest = rows[rows.length - 1];
  const solarKw = num(latest, "solar_generation_kw") || num(latest, "solar_kw");
  const renewablePct = Math.min(
    100,
    Math.round(num(latest, "renewable_utilization_score") * 100) ||
      Math.round(num(latest, "renewable_ratio") * 100),
  );
  const gridMixPct = Math.max(0, 100 - renewablePct);

  const forecast = rows.slice(-5).map((row, i) => ({
    hour: pickTime(row, i),
    solarKw: Math.round(num(row, "solar_generation_kw")),
    contributionPct: Math.min(100, Math.round(num(row, "renewable_ratio") * 100)),
  }));

  const carbonTotal = rows.reduce((s, r) => s + num(r, "carbon_savings_kg"), 0);
  const h = new Date(latest.timestamp || Date.now()).getHours();
  const weather =
    solarKw > 40
      ? { condition: "Clear / High irradiance", icon: "sunny" }
      : solarKw > 5
        ? { condition: "Partly cloudy", icon: "partly-cloudy" }
        : { condition: "Night / Low solar", icon: "night" };

  return {
    solarGenerationKw: Math.round(solarKw * 10) / 10,
    solarCapacityKw: 120,
    renewableContributionPct: renewablePct,
    gridMixPct,
    carbonSavingsKg: Math.round(carbonTotal * 10) / 10,
    carbonSavingsTodayKg: Math.round(num(latest, "carbon_savings_kg") * 10) / 10,
    weather: {
      ...weather,
      tempC: 22 + Math.sin(h / 24 * Math.PI * 2) * 6,
      humidity: 55,
      irradiance: Math.round(solarKw * 8.5),
      windKmh: 10,
    },
    forecast,
    status: solarKw > 2 ? "generating" : "idle",
    lastUpdated: latest.timestamp || new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Battery health
// ---------------------------------------------------------------------------

export function mapBatteryHealthPanel(rows) {
  if (!rows?.length) return null;

  const latest = rows[rows.length - 1];
  const health = num(latest, "battery_health_percent", 90);
  const degradation = num(latest, "degradation_score", 2);
  const thermal = num(latest, "thermal_index", 32);
  const stress = num(latest, "charging_stress_score", 50);

  const stressLevel = stress >= 70 ? "high" : stress >= 45 ? "moderate" : "low";
  const thermalStatus = thermal >= 42 ? "elevated" : thermal >= 35 ? "warm" : "normal";

  const recent = rows.slice(-24);
  const fleet = [
    { evId: "EV-001", health: Math.min(99, health + 4), stress: Math.max(10, stress - 20), temp: thermal - 4 },
    { evId: "EV-002", health: health, stress, temp: thermal },
    { evId: "EV-003", health: Math.max(70, health - 6), stress: Math.min(95, stress + 15), temp: thermal + 3 },
  ];

  const warnings = [];
  if (stress >= 65) {
    warnings.push({
      id: "w-stress",
      level: "warning",
      message: `Fleet charging stress at ${stress.toFixed(0)} — consider load shifting.`,
    });
  }
  if (num(latest, "battery_risk_level") >= 2) {
    warnings.push({
      id: "w-risk",
      level: "warning",
      message: `Battery risk level ${num(latest, "battery_risk_level")} — elevated degradation proxy.`,
    });
  }
  if (thermal >= 40) {
    warnings.push({
      id: "w-thermal",
      level: "info",
      message: `Thermal index ${thermal.toFixed(1)}°C — monitor fast-charge sessions.`,
    });
  }

  const avgHealth =
    recent.reduce((s, r) => s + num(r, "battery_health_percent", health), 0) / recent.length;

  return {
    healthPct: Math.round(avgHealth * 10) / 10,
    degradationPctPerYear: Math.round(degradation * 10) / 10,
    degradationStatus: degradation > 8 ? "elevated" : "normal",
    thermal: {
      status: thermalStatus,
      cellTempC: Math.round(thermal),
      ambientC: 24,
      maxSafeC: 45,
    },
    chargingStress: {
      level: stressLevel,
      score: Math.round(stress),
      fastChargeSessions: Math.round(stress / 25),
      deepCycles: Math.round(degradation),
    },
    predictedLifespan: {
      yearsRemaining: Math.max(3, 10 - degradation * 0.5),
      cyclesRemaining: Math.round(2000 - degradation * 80),
      confidencePct: 85,
    },
    fleet,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Energy flow digital twin
// ---------------------------------------------------------------------------

const BASE_OFFSET = 95;

export function mapEnergyFlowPanel(rows) {
  if (!rows?.length) return null;

  const latest = rows[rows.length - 1];
  const solar = num(latest, "solar_generation_kw");
  const gridLoad = num(latest, "grid_load_kw");
  const charging = num(latest, "charging_power_kw");
  const building = Math.max(BASE_OFFSET, gridLoad - charging * 0.35);
  const battery = charging * 0.55;
  const evs = charging * 0.85;
  const gridImport = Math.max(0, charging - solar * 0.4);

  const renewablePct = Math.min(100, Math.round(num(latest, "renewable_utilization_score") * 100));

  return {
    nodes: {
      solar: { label: "Solar PV", sublabel: "Live telemetry", kw: solar, color: "amber" },
      grid: { label: "Utility Grid", sublabel: "Import", kw: gridImport, color: "cyan" },
      building: { label: "Building", sublabel: "Aggregate load", kw: building, color: "slate" },
      battery: {
        label: "V2B Battery",
        sublabel: "Storage",
        kw: battery,
        soc: Math.round(num(latest, "soc_percent")),
        color: "violet",
      },
      chargers: {
        label: "EV Chargers",
        sublabel: `${Math.round(num(latest, "charger_utilization") * 100)}% util.`,
        kw: charging,
        color: "cyan",
      },
      evs: { label: "EV Fleet", sublabel: "Discharge/charge", kw: evs, color: "emerald" },
    },
    flows: [
      {
        id: "solar-building",
        from: "solar",
        to: "building",
        kw: Math.min(solar, building * 0.6),
        label: "Solar → Building",
        color: "#fbbf24",
      },
      {
        id: "grid-chargers",
        from: "grid",
        to: "chargers",
        kw: gridImport,
        label: "Grid → Chargers",
        color: "#22d3ee",
      },
      {
        id: "battery-evs",
        from: "battery",
        to: "evs",
        kw: battery,
        label: "Battery → EVs",
        color: "#a78bfa",
      },
    ],
    netBalance: {
      renewablePct,
      gridImportKw: Math.round(gridImport * 10) / 10,
      v2bExportKw: Math.round(Math.max(0, solar - building) * 10) / 10,
    },
  };
}

// ---------------------------------------------------------------------------
// AI decision panel (dynamic from telemetry)
// ---------------------------------------------------------------------------

export function mapDecisionPanel(rows) {
  if (!rows?.length) return [];

  const latest = rows[rows.length - 1];
  const ts = latest.timestamp || new Date().toISOString();
  const decisions = [];

  const push = (id, title, severity, recommendation, source, confidence, status = "active") => {
    decisions.push({ id, title, severity, timestamp: ts, recommendation, source, confidence, status });
  };

  const stress = num(latest, "grid_stress_index");
  const anomaly = num(latest, "anomaly_score");
  const peakRisk = num(latest, "predicted_peak_risk");
  const peakPenalty = num(latest, "peak_penalty");
  const renewable = num(latest, "renewable_ratio");
  const soc = num(latest, "soc_percent");
  const load = num(latest, "grid_load_kw");

  if (peakPenalty > 0.35 || stress > 0.55) {
    push(
      "peak-load",
      "Peak demand threshold approached",
      peakPenalty > 0.6 ? "critical" : "high",
      `Grid load ${load.toFixed(1)} kW with stress index ${(stress * 100).toFixed(0)}. Enable V2B discharge and cap fleet charging ${Math.round(load * 0.08)} kW.`,
      "Telemetry · grid_stress_index",
      0.88 + peakPenalty * 0.1,
    );
  }

  if (anomaly > 1.5) {
    push(
      "anomaly",
      "Anomalous load spike detected",
      anomaly > 3 ? "critical" : "high",
      `Anomaly score ${anomaly.toFixed(2)} exceeds baseline. Review concurrent sessions and charger allocation.`,
      "Telemetry · anomaly_score",
      Math.min(0.97, 0.75 + anomaly * 0.05),
    );
  }

  if (peakRisk > 0.55) {
    push(
      "peak-risk",
      "Predicted peak risk elevated",
      "high",
      `Predicted peak risk ${(peakRisk * 100).toFixed(0)}%. Pre-position solar offset and defer discretionary charging 1–2 hours.`,
      "Telemetry · predicted_peak_risk",
      0.85 + peakRisk * 0.1,
    );
  }

  if (renewable < 0.15 && num(latest, "solar_generation_kw") < 10) {
    push(
      "renewable-low",
      "Renewable availability low",
      "medium",
      `Renewable ratio ${(renewable * 100).toFixed(0)}%. Limit DC fast ramp; prioritize stored energy for building offset.`,
      "Telemetry · renewable_ratio",
      0.86,
    );
  }

  if (soc >= 88) {
    push(
      "soc-high",
      "Fleet SOC near target",
      "low",
      `Fleet SOC ${soc.toFixed(0)}%. Reduce charger setpoints to prevent overcharge; maintain mask floor for urgent sessions only.`,
      "Telemetry · soc_percent",
      0.9,
    );
  }

  if (decisions.length === 0) {
    push(
      "nominal",
      "Grid operating within nominal bounds",
      "low",
      `Load ${load.toFixed(1)} kW, stress ${(stress * 100).toFixed(0)}%, anomaly ${anomaly.toFixed(2)}. Continue DDPG policy tracking.`,
      "Telemetry · aggregate",
      0.95,
      "resolved",
    );
  }

  return decisions.slice(0, 6);
}

// ---------------------------------------------------------------------------
// Optimization panel
// ---------------------------------------------------------------------------

export function mapOptimizationPanel(rows) {
  if (!rows?.length) return null;

  const latest = rows[rows.length - 1];
  const reward = num(latest, "rl_reward_signal");
  const peakPenalty = num(latest, "peak_penalty");
  const renewable = num(latest, "renewable_utilization_score") || num(latest, "renewable_ratio");
  const load = num(latest, "grid_load_kw");
  const solar = num(latest, "solar_generation_kw");
  const charging = num(latest, "charging_power_kw");

  const energySavingsUsd = Math.max(0, reward * 80 + renewable * 40);
  const peakReductionKw = Math.round(peakPenalty * load * 0.15);

  return {
    metrics: {
      energySavingsUsd: Math.round(energySavingsUsd * 10) / 10,
      energySavingsPct: Math.round(renewable * 22 + Math.max(0, reward) * 8),
      peakReductionKw,
      peakReductionPct: Math.round(peakPenalty * 18),
      predictedReward: Math.round((reward + 1) * 80 * 10) / 10,
      episodesSimulated: rows.length,
      rlRewardSignal: reward,
      peakPenalty,
      renewableRatio: renewable,
      gridStress: num(latest, "grid_stress_index"),
    },
    recommendations: [
      {
        id: "rec-solar",
        title: "Maximize solar window dispatch",
        detail: `Current solar ${solar.toFixed(1)} kW · shift ${Math.round(charging * 0.3)} kW to peak irradiance hours.`,
        impact: `+${(renewable * 100).toFixed(0)}% renewable`,
        accent: "emerald",
      },
      {
        id: "rec-peak",
        title: "Apply peak shaving mask",
        detail: `Peak penalty ${(peakPenalty * 100).toFixed(0)}% — V2B discharge recommended when load > ${Math.round(load * 0.95)} kW.`,
        impact: `−${peakReductionKw} kW est.`,
        accent: "cyan",
      },
      {
        id: "rec-rl",
        title: "RL reward signal tuning",
        detail: `Current rl_reward_signal ${reward.toFixed(3)}. ${reward < 0 ? "Increase renewable weight in objective." : "Policy aligned with telemetry."}`,
        impact: `Reward ${reward.toFixed(2)}`,
        accent: "violet",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Metric cards (global KPIs from telemetry)
// ---------------------------------------------------------------------------

export function mapMetricKpis(rows) {
  if (!rows?.length) return [];

  const latest = rows[rows.length - 1];
  const loads = rows.map((r) => num(r, "grid_load_kw"));
  const avgLoad = loads.reduce((a, b) => a + b, 0) / loads.length;
  const activeEvs = Math.max(1, Math.round(num(latest, "charger_utilization") * 8));

  return [
    {
      id: "active-evs",
      title: "Active EVs",
      value: activeEvs,
      unit: "/ 8",
      subtitle: "From charger utilization",
      accent: "cyan",
      trend: { direction: "up", value: `+${Math.round(num(latest, "charger_utilization") * 100)}%`, label: "utilization" },
    },
    {
      id: "grid-load",
      title: "Grid Load",
      value: Math.round(num(latest, "grid_load_kw")),
      unit: "kW",
      subtitle: `Peak ${Math.round(num(latest, "peak_demand_kw"))} kW`,
      accent: "cyan",
      trend: {
        direction: num(latest, "grid_load_kw") > avgLoad ? "up" : "down",
        value: `${Math.round(((num(latest, "grid_load_kw") - avgLoad) / avgLoad) * 100)}%`,
        label: "vs avg",
      },
    },
    {
      id: "solar-usage",
      title: "Solar Usage",
      value: Math.min(100, Math.round(num(latest, "renewable_utilization_score") * 100)),
      unit: "%",
      subtitle: `${Math.round(num(latest, "solar_generation_kw"))} kW generation`,
      accent: "emerald",
      trend: { direction: "up", value: `${Math.round(num(latest, "renewable_ratio") * 100)}%`, label: "renewable ratio" },
    },
    {
      id: "rl-reward",
      title: "RL Reward",
      value: Math.round((num(latest, "rl_reward_signal") + 1) * 80 * 10) / 10,
      unit: "pts",
      subtitle: "From rl_reward_signal",
      accent: "violet",
      trend: {
        direction: num(latest, "rl_reward_signal") >= 0 ? "up" : "down",
        value: num(latest, "rl_reward_signal").toFixed(2),
        label: "signal",
      },
    },
  ];
}
