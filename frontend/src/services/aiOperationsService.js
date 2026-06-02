import api from "./api";
import env, { createEnvLogger } from "../config/env";

const logger = createEnvLogger("AIOps");

/**
 * Grid intelligence inference — strategies, risk, decisions, confidence.
 */
export async function fetchAiInference() {
  try {
    const { data } = await api.get("/ai/inference");
    return data && typeof data === "object" ? data : null;
  } catch (err) {
    logger.warn("fetchAiInference failed", err?.response?.status ?? err?.message);
    if (env.isProduction) {
      return {
        policy_source: "rule_engine_fallback",
        ai_recommendation: "AI inference unavailable — operating on safe defaults.",
        risk_level: "medium",
        confidence_score: 0.35,
        fallback: true,
      };
    }
    throw err;
  }
}

export async function fetchAiForecast(horizon = 6, window = 24) {
  const { data } = await api.get("/ai/forecast", { params: { horizon, window } });
  return data;
}

export async function fetchAiFleet() {
  try {
    const { data } = await api.get("/ai/fleet");
    const fleet = data?.fleet ?? data;
    return Array.isArray(fleet) ? fleet : [];
  } catch (err) {
    logger.warn("fetchAiFleet failed", err?.response?.status ?? err?.message);
    if (env.isProduction) return [];
    throw err;
  }
}

export async function fetchAiAlerts() {
  try {
    const { data } = await api.get("/ai/alerts");
    return data?.alerts ?? [];
  } catch (err) {
    logger.warn("fetchAiAlerts failed", err?.response?.status ?? err?.message);
    if (env.isProduction) return [];
    throw err;
  }
}

export async function fetchAiActivities() {
  try {
    const { data } = await api.get("/ai/activities");
    return data?.activities ?? [];
  } catch (err) {
    logger.warn("fetchAiActivities failed", err?.response?.status ?? err?.message);
    if (env.isProduction) return [];
    throw err;
  }
}
