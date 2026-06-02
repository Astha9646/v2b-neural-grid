import { CHART_MAX_POINTS } from "./streamConstants";

/** Recharts perf defaults — disables animation to prevent repaint storms. */
export const RECHARTS_PERF = Object.freeze({
  isAnimationActive: false,
  animationDuration: 0,
});

/** Shallow array reference check for chart data memoization. */
export function chartDataEqual(prev, next) {
  if (prev === next) return true;
  if (!Array.isArray(prev) || !Array.isArray(next) || prev.length !== next.length) return false;
  return prev.length === 0 || prev[0] === next[0];
}

export function computeYDomain(values, { padding = 0.12, minSpan = 10, floor = 0, ceil = null } = {}) {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return [floor, floor + minSpan];
  let min = Math.min(...nums);
  let max = Math.max(...nums);
  if (max - min < minSpan) {
    const mid = (min + max) / 2;
    min = mid - minSpan / 2;
    max = mid + minSpan / 2;
  }
  const pad = (max - min) * padding;
  min = Math.max(floor, min - pad);
  max = max + pad;
  if (ceil != null) max = Math.min(ceil, max);
  return [Math.floor(min), Math.ceil(max)];
}

export function hasEnoughChartPoints(data, min = 3) {
  return Array.isArray(data) && data.length >= min;
}

export function logChartDebug(name, data) {
  if (!import.meta.env.DEV) return;
  console.debug(`[Chart] ${name} points:`, data?.length ?? 0);
}

export { CHART_MAX_POINTS };
