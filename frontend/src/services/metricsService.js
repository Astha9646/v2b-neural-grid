import api from "./api";

/**
 * Normalize /metrics API payload — supports array or { metrics: [...] }.
 * @param {unknown} data
 * @returns {object[]}
 */
export function normalizeMetricsPayload(data) {
  if (Array.isArray(data)) {
    return data;
  }
  if (data && Array.isArray(data.metrics)) {
    return data.metrics;
  }
  return [];
}

export const getMetrics = async () => {
  const response = await api.get("/metrics");
  return normalizeMetricsPayload(response.data);
};
