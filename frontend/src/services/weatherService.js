/**
 * OpenWeather API client + solar irradiance estimation.
 * Set VITE_OPENWEATHER_API_KEY in Vercel for live data; falls back to demo values.
 */

import axios from "axios";

import env, { createEnvLogger } from "../config/env";

const logger = createEnvLogger("Weather");

const DEMO_WEATHER = Object.freeze({
  tempC: 24,
  humidity: 48,
  clouds: 25,
  windMs: 3.2,
  condition: "Clear",
  icon: "01d",
  solarIrradiance: 0.82,
  description: "Demo weather (set VITE_OPENWEATHER_API_KEY)",
});

const CACHE_MS = 10 * 60 * 1000;
const cacheByKey = new Map();
const inflightByKey = new Map();

function readApiKey() {
  return import.meta.env.VITE_OPENWEATHER_API_KEY?.trim() || "";
}

/** Estimate normalized solar irradiance [0–1] from cloud cover and condition. */
export function estimateSolarIrradiance({ clouds = 0, condition = "" } = {}) {
  const cloudFactor = 1 - clamp(clouds / 100, 0, 1) * 0.75;
  const cond = String(condition).toLowerCase();
  let weatherFactor = 1;
  if (cond.includes("rain") || cond.includes("drizzle")) weatherFactor = 0.35;
  else if (cond.includes("cloud")) weatherFactor = 0.65;
  else if (cond.includes("snow")) weatherFactor = 0.2;
  return Math.round(clamp(cloudFactor * weatherFactor, 0.05, 1) * 100) / 100;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export async function fetchWeather(lat = 12.9716, lon = 77.5946) {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const now = Date.now();
  const cached = cacheByKey.get(key);
  if (cached && now - cached.at < CACHE_MS) return cached.data;
  if (inflightByKey.has(key)) return inflightByKey.get(key);

  const apiKey = readApiKey();
  if (!apiKey) {
    const demo = { ...DEMO_WEATHER, isDemo: true };
    cacheByKey.set(key, { data: demo, at: now });
    return demo;
  }

  const promise = axios
    .get("https://api.openweathermap.org/data/2.5/weather", {
      params: { lat, lon, appid: apiKey, units: "metric" },
      timeout: 12_000,
    })
    .then((res) => {
      const d = res.data;
      const payload = {
        tempC: Math.round(d.main?.temp ?? 0),
        humidity: d.main?.humidity ?? 0,
        clouds: d.clouds?.all ?? 0,
        windMs: Math.round((d.wind?.speed ?? 0) * 10) / 10,
        condition: d.weather?.[0]?.main ?? "Unknown",
        description: d.weather?.[0]?.description ?? "",
        icon: d.weather?.[0]?.icon ?? "01d",
        isDemo: false,
      };
      payload.solarIrradiance = estimateSolarIrradiance(payload);
      cacheByKey.set(key, { data: payload, at: Date.now() });
      return payload;
    })
    .catch((err) => {
      logger.warn("weather fetch failed", err?.message);
      return { ...DEMO_WEATHER, isDemo: true, error: err?.message };
    })
    .finally(() => {
      inflightByKey.delete(key);
    });

  inflightByKey.set(key, promise);
  return promise;
}

/** Weather-adjusted renewable factor for viz + AI hints. */
export function weatherRenewableFactor(weather, telemetryRenewable = 0) {
  const irr = weather?.solarIrradiance ?? 0.5;
  return Math.round(clamp(irr * 0.6 + telemetryRenewable * 0.4, 0, 1) * 100) / 100;
}

export function weatherEffect3D(weather) {
  const cond = String(weather?.condition ?? "").toLowerCase();
  const temp = weather?.tempC ?? 24;
  const heat = temp > 32;
  return {
    sunIntensity: weather?.solarIrradiance ?? 0.5,
    cloudCover: (weather?.clouds ?? 30) / 100,
    rain: cond.includes("rain") || cond.includes("drizzle"),
    fog: cond.includes("mist") || cond.includes("fog"),
    night: weather?.icon?.endsWith("n") ?? false,
    heat,
    wetRoads: cond.includes("rain"),
  };
}

/** Map overlay intensities from live weather */
export function weatherMapEffects(weather) {
  const cond = String(weather?.condition ?? "").toLowerCase();
  const temp = weather?.tempC ?? 24;
  return {
    cloudDim: (weather?.clouds ?? 25) / 100,
    solarGlow: weather?.solarIrradiance ?? 0.5,
    rain: cond.includes("rain") || cond.includes("drizzle"),
    fog: cond.includes("mist") || cond.includes("fog"),
    thermalStress: clamp((temp - 28) / 12, 0, 1),
    solarPenalty: cond.includes("rain") ? 0.35 : cond.includes("cloud") ? 0.65 : 1,
  };
}
