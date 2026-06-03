import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { DEFAULT_CITY_ID, getCityPreset, getCityList } from "../data/cityPresets";

const CityPresetContext = createContext(null);

export function CityPresetProvider({ children }) {
  const [cityId, setCityId] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_CITY_ID;
    return localStorage.getItem("neural_grid_city") || DEFAULT_CITY_ID;
  });

  const selectCity = useCallback((id) => {
    setCityId(id);
    try {
      localStorage.setItem("neural_grid_city", id);
    } catch {
      /* ignore */
    }
  }, []);

  const preset = useMemo(() => getCityPreset(cityId), [cityId]);

  const value = useMemo(
    () => ({
      cityId,
      preset,
      center: preset.center,
      assets: preset.assets,
      flows: preset.flows,
      selectCity,
      cities: getCityList(),
    }),
    [cityId, preset, selectCity],
  );

  return <CityPresetContext.Provider value={value}>{children}</CityPresetContext.Provider>;
}

export function useCityPreset() {
  const ctx = useContext(CityPresetContext);
  if (!ctx) throw new Error("useCityPreset must be used within CityPresetProvider");
  return ctx;
}

export default CityPresetContext;
