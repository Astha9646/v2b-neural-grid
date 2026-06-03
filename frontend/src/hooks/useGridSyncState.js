/**
 * Throttled telemetry → map / 3D twin sync state.
 */

import { useMemo, useRef, useState, useEffect } from "react";

import { useTwinSlice, useTelemetryOps } from "../hooks/useTelemetrySelectors";
import { GRID_GEO_ASSETS } from "../data/gridGeoAssets";

const SYNC_MS = 2000;

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function statusFromStress(stress, anomaly) {
  if (stress > 0.72 || anomaly > 4) return "critical";
  if (stress > 0.52 || anomaly > 2.5) return "warning";
  return "ok";
}

/**
 * Derive per-asset live status from global telemetry + fleet ops.
 */
function buildAssetStates(latest, fleet, inference, alerts) {
  const stress = clamp(num(latest?.grid_stress_index), 0, 1);
  const renewable = clamp(num(latest?.renewable_ratio), 0, 1);
  const solarKw = num(latest?.solar_generation_kw);
  const loadKw = num(latest?.grid_load_kw);
  const soc = clamp(num(latest?.soc_percent), 0, 100);
  const chargingKw = num(latest?.charging_power_kw);
  const globalStatus = statusFromStress(stress, num(latest?.anomaly_score));

  const fleetById = Object.fromEntries((fleet || []).map((f) => [f.id, f]));

  return GRID_GEO_ASSETS.map((asset) => {
    let kw = 0;
    let status = globalStatus;
    let socLocal = null;

    switch (asset.type) {
      case "solar":
        kw = solarKw * (asset.id === "solar-1" ? 0.62 : 0.38);
        status = solarKw > 5 ? "ok" : "idle";
        break;
      case "building":
        kw = loadKw * 0.45;
        break;
      case "battery":
        kw = chargingKw < 0 ? Math.abs(chargingKw) * 0.4 : chargingKw * 0.25;
        socLocal = soc;
        status = soc < 20 ? "warning" : status;
        break;
      case "ev_charger": {
        const fleetRow = asset.fleetId ? fleetById[asset.fleetId] : null;
        kw = num(fleetRow?.charging_kw, chargingKw / 4);
        socLocal = num(fleetRow?.soc, soc);
        status = fleetRow?.status === "charging" ? "ok" : fleetRow?.status === "fault" ? "critical" : status;
        break;
      }
      case "utility":
      case "substation":
        kw = loadKw * 0.3;
        break;
      default:
        break;
    }

    return {
      ...asset,
      kw: Math.round(kw * 10) / 10,
      soc: socLocal,
      stress,
      renewable,
      status,
      optimization: inference?.optimization_action ?? "—",
    };
  });
}

function buildHeatZones(latest) {
  const stress = clamp(num(latest?.grid_stress_index), 0, 1);
  const center = { lat: 34.1377, lng: -118.1253 };
  return [
    { id: "heat-core", lat: center.lat, lng: center.lng, radiusM: 800 + stress * 400, intensity: stress },
    { id: "heat-east", lat: 34.139, lng: -118.12, radiusM: 500 + stress * 200, intensity: stress * 0.85 },
    { id: "heat-west", lat: 34.136, lng: -118.13, radiusM: 450, intensity: stress * 0.6 },
  ];
}

/**
 * Shared sync hook for map + 3D twin (throttled to protect FPS).
 */
export function useGridSyncState() {
  const { latest } = useTwinSlice();
  const { fleet, inference, alerts } = useTelemetryOps();
  const [synced, setSynced] = useState(() => ({
    assets: buildAssetStates(null, [], null, []),
    heatZones: buildHeatZones(null),
    latest: null,
    updatedAt: 0,
  }));
  const timerRef = useRef(null);

  useEffect(() => {
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setSynced({
        assets: buildAssetStates(latest, fleet, inference, alerts),
        heatZones: buildHeatZones(latest),
        latest,
        updatedAt: Date.now(),
      });
    }, SYNC_MS);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [latest, fleet, inference, alerts]);

  return useMemo(
    () => ({
      ...synced,
      fleet,
      inference,
      alerts,
    }),
    [synced, fleet, inference, alerts],
  );
}
