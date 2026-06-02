/**
 * Memoized telemetry selectors — subscribe to minimal slices to avoid rerender storms.
 */

import { useContext, useMemo } from "react";

import {
  TelemetryChartsContext,
  TelemetryOpsContext,
  TelemetryStreamContext,
} from "../context/TelemetryContext";

export function useTelemetryStream() {
  const ctx = useContext(TelemetryStreamContext);
  if (!ctx) {
    throw new Error("useTelemetryStream must be used within TelemetryProvider");
  }
  return ctx;
}

export function useTelemetryCharts() {
  const ctx = useContext(TelemetryChartsContext);
  if (!ctx) {
    throw new Error("useTelemetryCharts must be used within TelemetryProvider");
  }
  return ctx;
}

export function useTelemetryOps() {
  const ctx = useContext(TelemetryOpsContext);
  if (!ctx) {
    throw new Error("useTelemetryOps must be used within TelemetryProvider");
  }
  return ctx;
}

/** Stream meta only — for badges and connection indicators. */
export function useStreamMeta() {
  const {
    isStreaming,
    streamStatus,
    lastUpdated,
    isLive,
    loading,
    error,
    refresh,
  } = useTelemetryStream();
  return useMemo(
    () => ({
      isStreaming,
      streamStatus,
      lastUpdated,
      isLive,
      loading,
      error,
      refresh,
    }),
    [isStreaming, streamStatus, lastUpdated, isLive, loading, error, refresh],
  );
}

/** Chart bundle — load/soc/charging series + summary. */
export function useChartSeries() {
  const { charts, summary, latest, loading, error, refresh } = useTelemetryCharts();
  const { isStreaming, streamStatus, lastUpdated, isLive } = useTelemetryStream();
  return useMemo(
    () => ({
      charts,
      summary,
      latest,
      loading,
      error,
      refresh,
      isStreaming,
      streamStatus,
      lastUpdated,
      isLive,
    }),
    [
      charts,
      summary,
      latest,
      loading,
      error,
      refresh,
      isStreaming,
      streamStatus,
      lastUpdated,
      isLive,
    ],
  );
}

/** Forecast slice for predictive panels. */
export function useForecastSlice() {
  const {
    forecast,
    forecastLoading,
    forecastError,
    forecastLive,
    forecastLastUpdated,
    refreshForecast,
  } = useTelemetryOps();
  const { isStreaming, streamStatus, lastUpdated } = useTelemetryStream();
  return useMemo(
    () => ({
      forecast,
      forecastLoading,
      forecastError,
      forecastLive,
      forecastLastUpdated,
      refreshForecast,
      isStreaming,
      streamStatus,
      lastUpdated,
    }),
    [
      forecast,
      forecastLoading,
      forecastError,
      forecastLive,
      forecastLastUpdated,
      refreshForecast,
      isStreaming,
      streamStatus,
      lastUpdated,
    ],
  );
}

/** Digital twin inputs — throttled scene drivers. */
export function useTwinSlice() {
  const { latest } = useTelemetryCharts();
  const { fleet, inference, forecast, loading, error } = useTelemetryOps();
  const stream = useStreamMeta();
  return useMemo(
    () => ({
      latest,
      fleet,
      inference,
      forecast,
      loading,
      error,
      ...stream,
    }),
    [latest, fleet, inference, forecast, loading, error, stream],
  );
}

/** KPI cards — metricKpis + stream status. */
export function useMetricKpisSlice() {
  const { metricKpis } = useTelemetryCharts();
  const stream = useStreamMeta();
  return useMemo(() => ({ metricKpis, ...stream }), [metricKpis, stream]);
}

/** Panel slice from charts context + stream meta. */
export function useChartsPanelSlice(field) {
  const charts = useTelemetryCharts();
  const stream = useStreamMeta();
  const value = charts[field];
  return useMemo(
    () => ({
      [field]: value,
      loading: stream.loading,
      error: stream.error,
      isLive: stream.isLive,
      isStreaming: stream.isStreaming,
      streamStatus: stream.streamStatus,
      lastUpdated: stream.lastUpdated,
      refresh: stream.refresh,
    }),
    [field, value, stream],
  );
}

/** Single ops field + stream meta (e.g. fleet, alerts). */
export function useOpsPanelSlice(field) {
  const ops = useTelemetryOps();
  const stream = useStreamMeta();
  const value = ops[field];
  return useMemo(
    () => ({
      [field]: value,
      loading: stream.loading,
      error: stream.error,
      isLive: stream.isLive,
      isStreaming: stream.isStreaming,
      streamStatus: stream.streamStatus,
      lastUpdated: stream.lastUpdated,
      refresh: stream.refresh,
    }),
    [field, value, stream],
  );
}

/** Decisions panel — inference-driven ops slice. */
export function useDecisionsSlice() {
  const { decisions, inference } = useTelemetryOps();
  const stream = useStreamMeta();
  return useMemo(() => ({ decisions, inference, ...stream }), [decisions, inference, stream]);
}

/** Activity feed — events + activities slice. */
export function useActivitiesSlice() {
  const { activities, streamEvents } = useTelemetryOps();
  const stream = useStreamMeta();
  return useMemo(() => ({ activities, streamEvents, ...stream }), [activities, streamEvents, stream]);
}
