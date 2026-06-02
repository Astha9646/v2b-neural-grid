import api from "./api";
import env, { createEnvLogger } from "../config/env";

const logger = createEnvLogger("Telemetry");

/** @deprecated Polling replaced by WebSocket streams; kept for HTTP fallback reference. */
export const TELEMETRY_REFRESH_MS = 10_000;

/**
 * Fetch hourly smart-grid telemetry from GET /dataset.
 * Returns an empty array on failure in production (graceful dashboard fallback).
 * @returns {Promise<object[]>}
 */
export async function fetchTelemetry() {
  try {
    const response = await api.get("/dataset");
    const data = response.data;
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.records)) return data.records;
    if (data && Array.isArray(data.rows)) return data.rows;
    return [];
  } catch (err) {
    logger.warn("fetchTelemetry failed", err?.response?.status ?? err?.message);
    if (env.isProduction) {
      return [];
    }
    throw err;
  }
}

/**
 * @param {object[]} rows
 * @returns {object|null}
 */
export function getLatestRow(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[rows.length - 1];
}

/**
 * Aggregate summary statistics for KPI cards and AI panels.
 * @param {object[]} rows
 */
export function computeTelemetrySummary(rows) {
  if (!rows?.length) {
    return null;
  }

  const latest = rows[rows.length - 1];
  const loads = rows.map((r) => Number(r.grid_load_kw ?? r.load ?? 0));
  const socs = rows.map((r) => Number(r.soc_percent ?? r.soc ?? 0));
  const solar = rows.map((r) => Number(r.solar_generation_kw ?? 0));

  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  return {
    latest,
    timestamp: latest.timestamp,
    gridLoadKw: Number(latest.grid_load_kw ?? 0),
    peakDemandKw: Number(latest.peak_demand_kw ?? Math.max(...loads, 0)),
    socPercent: Number(latest.soc_percent ?? 0),
    solarKw: Number(latest.solar_generation_kw ?? 0),
    renewableRatio: Number(latest.renewable_ratio ?? 0),
    renewablePct: Math.round(Number(latest.renewable_utilization_score ?? latest.renewable_ratio ?? 0) * 100),
    carbonSavingsKg: Number(latest.carbon_savings_kg ?? 0),
    rlReward: Number(latest.rl_reward_signal ?? 0),
    peakPenalty: Number(latest.peak_penalty ?? 0),
    gridStress: Number(latest.grid_stress_index ?? 0),
    anomalyScore: Number(latest.anomaly_score ?? 0),
    predictedPeakRisk: Number(latest.predicted_peak_risk ?? 0),
    batteryHealth: Number(latest.battery_health_percent ?? 0),
    chargingStress: Number(latest.charging_stress_score ?? 0),
    chargerUtilization: Number(latest.charger_utilization ?? 0),
    avgLoadKw: avg(loads),
    avgSoc: avg(socs),
    maxSolarKw: solar.length ? Math.max(...solar, 0) : 0,
    rowCount: rows.length,
  };
}

/** Zero-baseline fallback bundle when telemetry HTTP fetch fails. */
export function emptyTelemetryFallback() {
  return {
    rows: [],
    summary: null,
    fallback: true,
  };
}
