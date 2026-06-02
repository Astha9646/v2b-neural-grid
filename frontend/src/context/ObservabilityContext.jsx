import { createContext, useContext, useMemo } from "react";

import useSystemMetrics from "../hooks/useSystemMetrics";

const ObservabilityContext = createContext(null);

export function ObservabilityProvider({ children, pollMs = 12_000, enabled = true }) {
  const metrics = useSystemMetrics({ pollMs, enabled });

  const value = useMemo(
    () => metrics,
    [
      metrics.health,
      metrics.metrics,
      metrics.performance,
      metrics.panelHealth,
      metrics.historyPoint,
      metrics.loading,
      metrics.error,
      metrics.refresh,
    ],
  );

  return (
    <ObservabilityContext.Provider value={value}>{children}</ObservabilityContext.Provider>
  );
}

export function useObservability() {
  const ctx = useContext(ObservabilityContext);
  if (!ctx) {
    return {
      health: null,
      metrics: null,
      performance: null,
      panelHealth: null,
      loading: false,
      error: null,
      refresh: () => {},
      historyPoint: null,
    };
  }
  return ctx;
}

export default ObservabilityContext;
