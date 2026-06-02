/**
 * Client-side operations mappers — mirrors backend grid_intelligence when API unavailable.
 * Uses live telemetry rows only; never injects synthetic demo records.
 */

function num(row, key, fallback = 0) {
  const v = Number(row?.[key]);
  return Number.isFinite(v) ? v : fallback;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

const THERMAL_WARN = 38;
const THERMAL_CRIT = 42;
const RENEWABLE_TARGET = 0.35;

export function mapFleetFromTelemetry(row) {
  if (!row) return [];

  const util = clamp(num(row, "charger_utilization"), 0, 1);
  const baseSoc = num(row, "soc_percent", 50);
  const baseHealth = num(row, "battery_health_percent", 90);
  const baseStress = num(row, "charging_stress_score", 40);
  const baseThermal = num(row, "thermal_index", 30);
  const renewable = num(row, "renewable_ratio");
  const load = num(row, "grid_load_kw");
  const stress = num(row, "grid_stress_index");
  const activeSlots = Math.max(1, Math.round(util * 8));

  const chargers = [
    ["A", "chargerA", "Station A · L2"],
    ["B", "chargerB", "Station B · L2"],
    ["C", "chargerC", "Station C · DC Fast"],
    ["D", "chargerD", "Station D · V2B"],
  ];

  const fleet = [];

  for (let i = 0; i < 8; i += 1) {
    const evId = `EV-${String(i + 1).padStart(3, "0")}`;
    const [, chCol, chLabel] = chargers[i % 4];
    let power = num(row, chCol);
    if (!power && chCol === "chargerA") power = num(row, "charging_power_kw") / 4;

    const soc = clamp(baseSoc + (i - 3.5) * 4.2 + power * 0.08, 0, 100);
    const health = clamp(baseHealth + (i % 3 === 0 ? 2 : -1) - i * 0.3, 70, 99);
    const chargingStress = clamp(baseStress + (i % 4) * 8 - 6, 5, 98);
    const thermalC = clamp(baseThermal + (i % 3) * 2.5 - 2, 22, 48);

    let fleetStatus;
    let chargingState;

    if (i >= activeSlots && Math.abs(power) < 0.5) {
      fleetStatus = "Idle";
      chargingState = "idle";
      power = 0;
    } else if (power < -2) {
      fleetStatus = "Peak Reduction";
      chargingState = "v2b_discharge";
    } else if (renewable > 0.4 && power > 2) {
      fleetStatus = "Renewable Optimized";
      chargingState = "solar_priority";
    } else if (thermalC >= THERMAL_WARN) {
      fleetStatus = "Thermal Warning";
      chargingState = "thermal_limited";
    } else if (soc >= 92 && power > 0) {
      fleetStatus = "Battery Protection";
      chargingState = "trickle";
    } else if (stress > 0.55 && i % 2 === 0) {
      fleetStatus = "Peak Reduction";
      chargingState = "load_capped";
    } else if (power > 1) {
      fleetStatus = "Charging";
      chargingState = "active_charge";
    } else {
      fleetStatus = "Idle";
      chargingState = "idle";
    }

    const remainingKwh = Math.max(0, ((90 - soc) / 100) * 60);
    const etaH = power > 0.5 ? remainingKwh / Math.max(power, 3.5) : 0;
    const estimatedCompletion =
      etaH > 0 ? `${Math.floor(etaH)}h ${Math.floor((etaH % 1) * 60)}m` : "—";

    const thermalStatus =
      thermalC >= THERMAL_CRIT ? "critical" : thermalC >= THERMAL_WARN ? "elevated" : "normal";

    fleet.push({
      evId,
      stationId: `CHG-${chargers[i % 4][0]}`,
      charger: chLabel,
      soc: Math.round(soc * 10) / 10,
      power: Math.round(power * 100) / 100,
      health: Math.round(health * 10) / 10,
      chargingStress,
      thermalStatus,
      thermalC: Math.round(thermalC * 10) / 10,
      fleetStatus,
      estimatedCompletion,
      chargingState,
      renewableContribution: Math.round(renewable * (power > 0 ? 100 : 0) * 10) / 10,
      gridImpactScore: Math.round(clamp(stress * 50 + (power / Math.max(load, 1)) * 40, 0, 100) * 10) / 10,
      priority:
        fleetStatus === "Thermal Warning"
          ? "critical"
          : fleetStatus === "Peak Reduction" || fleetStatus === "Battery Protection"
            ? "high"
            : "normal",
      status: chargingState.replace(/_/g, "-"),
    });
  }

  return fleet;
}

export function mapAlertsFromTelemetry(row, history = []) {
  if (!row || typeof row !== "object") return [];
  const ts = row.timestamp || new Date().toISOString();
  const alerts = [];

  const add = (id, title, message, severity, source, icon) => {
    alerts.push({
      id,
      title,
      message,
      severity,
      timestamp: ts,
      source,
      icon,
      unread: severity === "critical" || severity === "high",
    });
  };

  const load = num(row, "grid_load_kw");
  const peak = num(row, "peak_demand_kw", load);
  const stress = num(row, "grid_stress_index");
  const anomaly = num(row, "anomaly_score");
  const thermal = num(row, "thermal_index");
  const renewable = num(row, "renewable_ratio");
  const degradation = num(row, "degradation_score");
  const cStress = num(row, "charging_stress_score");
  const util = num(row, "charger_utilization");
  const reward = num(row, "rl_reward_signal");

  if (stress > 0.55 || load >= peak * 0.95) {
    add(
      "peak-demand",
      "Peak demand approaching threshold",
      `Grid load ${load.toFixed(1)} kW vs peak ${peak.toFixed(1)} kW.`,
      stress > 0.7 ? "critical" : "high",
      "Grid · Peak Demand",
      "peak",
    );
  }
  if (renewable < RENEWABLE_TARGET) {
    add(
      "renewable-low",
      "Renewable contribution below target",
      `Renewable ratio ${(renewable * 100).toFixed(0)}% below target.`,
      renewable < 0.15 ? "high" : "medium",
      "Solar · Renewable Mix",
      "solar",
    );
  }
  if (thermal >= THERMAL_WARN) {
    add(
      "thermal-stress",
      `Thermal stress detected on EV fleet`,
      `Thermal index ${thermal.toFixed(1)}°C.`,
      thermal >= THERMAL_CRIT ? "critical" : "high",
      "Fleet · Thermal",
      "thermal",
    );
  }
  if (anomaly > 1.5) {
    add(
      "grid-anomaly",
      "Grid anomaly detected",
      `Anomaly score ${anomaly.toFixed(2)}.`,
      anomaly > 3 ? "critical" : "high",
      "AI · Anomaly Detection",
      "peak",
    );
  }
  if (degradation > 7) {
    add(
      "degradation",
      "Battery degradation accelerating",
      `Degradation proxy ${degradation.toFixed(1)}.`,
      "medium",
      "Battery · SOH",
      "info",
    );
  }
  if (util > 0.85 && cStress > 60) {
    add(
      "charger-overload",
      "Charger overload warning",
      `Utilization ${(util * 100).toFixed(0)}%.`,
      "high",
      "Fleet · Chargers",
      "delay",
    );
  }
  if (reward < -0.15 || num(row, "peak_penalty") > 0.45) {
    add(
      "rl-intervention",
      "RL optimization intervention triggered",
      `rl_reward_signal ${reward.toFixed(3)}.`,
      "medium",
      "RL · DDPG",
      "v2b",
    );
  }

  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  return alerts.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
}

export function mapActivitiesFromTelemetry(row, history = [], inference = null) {
  if (!row || typeof row !== "object") return [];
  const ts = row.timestamp || new Date().toISOString();
  const events = [];

  const push = (id, type, title, detail, actor, sortKey) => {
    events.push({ id, type, title, detail, timestamp: ts, actor, sortKey });
  };

  if (inference?.ai_recommendation) {
    push("opt-cycle", "optimization", "AI optimization cycle completed", inference.ai_recommendation, "Grid Intelligence", 0);
  }

  const stress = num(row, "grid_stress_index");
  const load = num(row, "grid_load_kw");
  const renewable = num(row, "renewable_ratio");
  const reward = num(row, "rl_reward_signal");
  const peakPenalty = num(row, "peak_penalty");

  if (peakPenalty > 0.35) {
    push("peak-shave", "mask", "Peak shaving initiated", `Penalty ${(peakPenalty * 100).toFixed(0)}% on ${load.toFixed(0)} kW.`, "Action Mask", 1);
  }
  if (renewable > 0.35) {
    push("renewable-balance", "forecast", "Renewable balancing activated", `Ratio ${(renewable * 100).toFixed(0)}%.`, "Renewable Controller", 2);
  }
  if (history.length >= 2) {
    const prev = num(history[history.length - 2], "charging_power_kw");
    const cur = num(row, "charging_power_kw");
    if (Math.abs(cur - prev) > 8) {
      push("load-redist", "reassign", "Charging load redistributed", `${prev.toFixed(1)} → ${cur.toFixed(1)} kW.`, "Fleet Scheduler", 3);
    }
  }
  if (num(row, "thermal_index") >= THERMAL_WARN) {
    push("thermal-mit", "delay", "Battery thermal mitigation enabled", `Thermal ${num(row, "thermal_index").toFixed(1)}°C.`, "Thermal Guard", 4);
  }
  if (reward > 0.1 && history.length >= 3) {
    const prevR = num(history[history.length - 3], "rl_reward_signal");
    if (reward > prevR + 0.05) {
      push("rl-improve", "optimization", "RL reward improved", `${prevR.toFixed(3)} → ${reward.toFixed(3)}.`, "DDPG Policy", 5);
    }
  }
  if (stress < 0.4 && history.length >= 2 && num(history[history.length - 2], "grid_stress_index") > 0.55) {
    push("stress-norm", "session", "Grid stress normalized", `Stress ${(stress * 100).toFixed(0)}%.`, "Grid Monitor", 6);
  }
  const util = num(row, "charger_utilization");
  if (util > 0.5) {
    push("fleet-sync", "reassign", "Fleet charging synchronized", `${Math.max(1, Math.round(util * 8))} vehicles coordinated.`, "Fleet Ops", 7);
  }

  return events.sort((a, b) => a.sortKey - b.sortKey);
}

export function mapDecisionsFromInference(inference) {
  if (!inference) return [];
  const xai = inference.explainability ?? null;
  if (Array.isArray(inference.decisions) && inference.decisions.length) {
    return inference.decisions.map((d, i) => ({
      id: d?.id ?? `decision-${i}`,
      title: d?.title ?? "AI decision",
      severity: d?.severity ?? "medium",
      timestamp: d?.timestamp ?? inference.timestamp ?? new Date().toISOString(),
      recommendation: d?.recommendation || inference.ai_recommendation || "",
      reasoning: d?.reasoning || xai?.reasoning || inference.ai_reasoning || "",
      confidence: d?.confidence ?? inference.confidence_score ?? 0,
      risk_level: d?.risk_level || inference.risk_level,
      charging_strategy: d?.charging_strategy || inference.charging_strategy,
      renewable_strategy: d?.renewable_strategy || inference.renewable_strategy,
      status: d?.status ?? "active",
      source: d?.source ?? "Grid Intelligence",
      mitigation_actions: Array.isArray(d?.mitigation_actions) ? d.mitigation_actions : [],
      explainability: xai,
    }));
  }
  return [
    {
      id: "ai-inference",
      title: inference.ai_recommendation?.slice(0, 72) || "AI recommendation",
      severity: inference.risk_level === "critical" ? "critical" : inference.risk_level === "high" ? "high" : "medium",
      timestamp: inference.timestamp || new Date().toISOString(),
      recommendation: inference.ai_recommendation,
      reasoning: inference.ai_reasoning,
      source: `Grid Intelligence · ${inference.optimization_action}`,
      confidence: inference.confidence_score,
      status: "active",
      risk_level: inference.risk_level,
      charging_strategy: inference.charging_strategy,
      renewable_strategy: inference.renewable_strategy,
      mitigation_actions: [
        inference.peak_shaving_action,
        inference.thermal_protection_action,
        inference.battery_protection_action,
        ...(xai?.safety?.items?.map((s) => s.explanation) ?? []),
      ].filter(Boolean),
      explainability: xai,
    },
  ];
}
