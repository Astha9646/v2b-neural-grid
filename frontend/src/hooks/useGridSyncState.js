/**
 * Throttled telemetry → map / 3D twin sync state.
 */

import { useMemo, useRef, useState, useEffect } from "react";

import { useTwinSlice, useTelemetryOps } from "../hooks/useTelemetrySelectors";
import { useCityPreset } from "../context/CityPresetContext";
import { useStoryMode } from "../context/StoryModeContext";

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

function buildAssetStates(geoAssets, latest, fleet, inference, storyStress, storyFlags) {
  let stress = clamp(num(latest?.grid_stress_index), 0, 1);
  if (storyStress != null) stress = storyStress;

  const renewable = clamp(
    num(latest?.renewable_ratio) + (storyFlags?.renewableBoost ? 0.12 : 0),
    0,
    1,
  );
  const solarKw = num(latest?.solar_generation_kw);
  const loadKw = num(latest?.grid_load_kw);
  const soc = clamp(num(latest?.soc_percent), 0, 100);
  const chargingKw = num(latest?.charging_power_kw);
  const thermal = clamp(num(latest?.thermal_index), 0, 1);
  const batteryHealth = clamp(1 - num(latest?.degradation_score) / 100, 0, 1);
  const predictedLoad = num(latest?.peak_demand_kw, loadKw);
  const globalStatus = statusFromStress(stress, num(latest?.anomaly_score));

  const fleetById = Object.fromEntries((fleet || []).map((f) => [f.id, f]));
  const evScale = storyFlags?.evThrottled ? 0.55 : 1;
  const batScale = storyFlags?.batteryActive ? 1.35 : 1;

  return geoAssets.map((asset) => {
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
        kw = (chargingKw < 0 ? Math.abs(chargingKw) * 0.4 : chargingKw * 0.25) * batScale;
        socLocal = soc;
        status = soc < 20 ? "warning" : status;
        break;
      case "ev_charger": {
        const fleetRow = asset.fleetId ? fleetById[asset.fleetId] : null;
        kw = num(fleetRow?.charging_kw, chargingKw / 4) * evScale;
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
      thermal,
      batteryHealth,
      predictedLoad,
      status,
      optimization: inference?.optimization_action ?? "Monitoring grid equilibrium",
    };
  });
}

function buildHeatPointsFromAssets(assets, stress, center) {
  const base = stress * 0.55;
  return assets
    .filter((a) => ["substation", "utility", "building", "ev_charger"].includes(a.type))
    .map((a) => {
      const local = a.status === "critical" ? 1 : a.status === "warning" ? 0.7 : 0.35;
      const renBoost = a.type === "solar" ? 0.2 : 0;
      return [a.lat, a.lng, base + local * 0.35 + renBoost];
    });
}

export function useGridSyncState() {
  const { assets: geoAssets, center } = useCityPreset();
  const { latest } = useTwinSlice();
  const { fleet, inference, alerts } = useTelemetryOps();
  const { storyStress, storyFlags } = useStoryMode();

  const [synced, setSynced] = useState(() => ({
    assets: buildAssetStates(geoAssets, null, [], null, null, null),
    latest: null,
    updatedAt: 0,
  }));
  const timerRef = useRef(null);

  useEffect(() => {
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setSynced({
        assets: buildAssetStates(geoAssets, latest, fleet, inference, storyStress, storyFlags),
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
  }, [geoAssets, latest, fleet, inference, storyStress, storyFlags]);

  const stress = synced.assets[0]?.stress ?? num(latest?.grid_stress_index);

  return useMemo(
    () => ({
      ...synced,
      stress,
      heatPoints: buildHeatPointsFromAssets(synced.assets, stress, center),
      fleet,
      inference,
      alerts,
    }),
    [synced, stress, center, fleet, inference, alerts],
  );
}
