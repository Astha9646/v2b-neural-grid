import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useCityPreset } from "./CityPresetContext";
import {
  fetchWeather,
  weatherEffect3D,
  weatherMapEffects,
  weatherRenewableFactor,
} from "../services/weatherService";
import { useTwinSlice } from "../hooks/useTelemetrySelectors";
import { createEnvLogger } from "../config/env";

const logger = createEnvLogger("WeatherContext");

const WeatherContext = createContext(null);

export function WeatherProvider({ children }) {
  const { center } = useCityPreset();
  const { latest } = useTwinSlice();
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchWeather(center.lat, center.lng);
      setWeather(data);
    } catch (err) {
      logger.warn("refresh failed", err?.message);
    } finally {
      setLoading(false);
    }
  }, [center.lat, center.lng]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [refresh]);

  const renewableBlend = useMemo(() => {
    const telemetryRen = Number(latest?.renewable_ratio) || 0;
    return weatherRenewableFactor(weather, telemetryRen);
  }, [weather, latest?.renewable_ratio]);

  const effects3d = useMemo(() => weatherEffect3D(weather), [weather]);
  const mapEffects = useMemo(() => weatherMapEffects(weather), [weather]);

  const value = useMemo(
    () => ({
      weather,
      loading,
      refresh,
      renewableBlend,
      effects3d,
      mapEffects,
    }),
    [weather, loading, refresh, renewableBlend, effects3d, mapEffects],
  );

  return <WeatherContext.Provider value={value}>{children}</WeatherContext.Provider>;
}

export function useWeather() {
  const ctx = useContext(WeatherContext);
  if (!ctx) throw new Error("useWeather must be used within WeatherProvider");
  return ctx;
}

export default WeatherContext;
