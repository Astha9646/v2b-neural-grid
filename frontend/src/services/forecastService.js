import api from "./api";
import env, { createEnvLogger } from "../config/env";

const logger = createEnvLogger("Forecast");

export const FORECAST_REFRESH_MS = 15_000;
export const FORECAST_CACHE_MS = 5_000;
export const FORECAST_TIMEOUT_MS = env.isProduction ? 12_000 : 20_000;
export const FORECAST_MAX_RETRIES = env.isProduction ? 2 : 1;

const cache = {
  key: "",
  data: null,
  fetchedAt: 0,
};

let inflight = null;

function cacheKey(horizon, window) {
  return `${horizon}:${window}`;
}

function isFresh(key) {
  return cache.key === key && Date.now() - cache.fetchedAt < FORECAST_CACHE_MS && cache.data;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Production-safe zero baseline when all fetch attempts fail. */
export function emptyForecastFallback(horizon = 6, window = 24) {
  const zeros = Array.from({ length: horizon }, () => 0);
  return {
    load_kw: zeros,
    peak_demand_kw: zeros,
    renewable_kw: zeros,
    soc_percent: zeros.map(() => 50),
    charging_demand_kw: zeros,
    grid_stress_index: zeros,
    horizon,
    window,
    timestamps: zeros.map(() => ""),
    summary: { load_trend_1h: 0, load_ma_24: 0, load_forecast_next: 0 },
    fallback: true,
  };
}

/**
 * Fetch predictive forecast from GET /ai/forecast with retry, timeout, and cache.
 * @param {{ horizon?: number, window?: number, force?: boolean }} options
 */
export async function fetchForecast({ horizon = 6, window = 24, force = false } = {}) {
  const key = cacheKey(horizon, window);
  if (!force && isFresh(key)) {
    return cache.data;
  }

  if (inflight) {
    return inflight;
  }

  inflight = (async () => {
    let lastError = null;

    for (let attempt = 0; attempt <= FORECAST_MAX_RETRIES; attempt += 1) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FORECAST_TIMEOUT_MS);

        const { data } = await api.get("/ai/forecast", {
          params: { horizon, window },
          signal: controller.signal,
        });

        clearTimeout(timer);

        const payload = data && typeof data === "object" ? data : null;
        if (!payload) {
          throw new Error("Empty forecast response");
        }

        cache.key = key;
        cache.data = payload;
        cache.fetchedAt = Date.now();
        logger.debug("forecast fetched", { horizon, window, fallback: payload.fallback });
        return payload;
      } catch (err) {
        lastError = err;
        logger.warn("forecast attempt failed", attempt + 1, err?.message ?? err);
        if (attempt < FORECAST_MAX_RETRIES) {
          await sleep(400 * (attempt + 1));
        }
      }
    }

    if (cache.data && cache.key === key) {
      logger.warn("using stale forecast cache after fetch failure");
      return { ...cache.data, stale: true };
    }

    if (env.isProduction) {
      logger.warn("returning empty forecast fallback");
      return emptyForecastFallback(horizon, window);
    }

    throw lastError ?? new Error("Forecast fetch failed");
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export function clearForecastCache() {
  cache.key = "";
  cache.data = null;
  cache.fetchedAt = 0;
}
