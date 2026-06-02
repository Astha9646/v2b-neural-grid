import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchObservabilityBundle,
  mapHealthToPanel,
} from "../services/systemService";

const DEFAULT_POLL_MS = 12_000;

/**
 * Throttled observability polling with cleanup (no leak on unmount).
 *
 * @param {{ pollMs?: number, enabled?: boolean }} [options]
 */
export function useSystemMetrics({ pollMs = DEFAULT_POLL_MS, enabled = true } = {}) {
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);
  const timerRef = useRef(null);
  const refreshLockRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled || refreshLockRef.current) return;
    refreshLockRef.current = true;
    try {
      const data = await fetchObservabilityBundle();
      if (!mountedRef.current) return;
      setBundle(data);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err?.message || "Failed to load system metrics");
    } finally {
      refreshLockRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) {
      setLoading(false);
      return undefined;
    }

    refresh();
    timerRef.current = setInterval(refresh, pollMs);

    return () => {
      mountedRef.current = false;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, pollMs, refresh]);

  const panelHealth = useMemo(
    () => mapHealthToPanel(bundle?.health, bundle?.metrics, bundle?.performance),
    [bundle],
  );

  const historyPoint = useMemo(() => {
    if (!bundle?.health) return null;
    return {
      t: Date.now(),
      cpu: bundle.health.cpu_percent,
      ram: bundle.health.ram_percent,
      gpu: bundle.health.gpu_percent,
      streamRate: bundle.health.stream_rate,
      rps: bundle.health.requests_per_second,
      inferenceMs: bundle.health.inference_latency_ms,
      forecastMs: bundle.health.forecast_latency_ms ?? bundle.metrics?.forecast_latency_ms,
    };
  }, [bundle?.health, bundle?.metrics?.forecast_latency_ms]);

  return {
    health: bundle?.health ?? null,
    metrics: bundle?.metrics ?? null,
    performance: bundle?.performance ?? null,
    panelHealth,
    historyPoint,
    loading,
    error,
    refresh,
  };
}

export default useSystemMetrics;
