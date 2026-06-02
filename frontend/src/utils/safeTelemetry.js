/** Defensive helpers for null-safe telemetry / AI dashboard code */

export const EMPTY_ARRAY = Object.freeze([]);

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function safeReduce(array, reducer, initial) {
  const list = asArray(array);
  if (!list.length) return initial;
  return list.reduce(reducer, initial);
}

export function safeMax(array, selector = (x) => x, fallback = 0) {
  const list = asArray(array);
  if (!list.length) return fallback;
  let max = selector(list[0]);
  for (let i = 1; i < list.length; i += 1) {
    const v = selector(list[i]);
    if (v > max) max = v;
  }
  return max;
}

export function safeArgMax(array, selector = (x) => x, fallback = null) {
  const list = asArray(array);
  if (!list.length) return fallback;
  return list.reduce((best, item) => (selector(item) > selector(best) ? item : best), list[0]);
}
