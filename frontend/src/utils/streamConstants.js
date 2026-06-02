/** Max telemetry rows retained client-side (charts + memory). */
export const MAX_TELEMETRY_HISTORY = 50;

/** Chart time-series window (matches telemetry cap). */
export const CHART_MAX_POINTS = 50;

/** Batch WebSocket-driven React updates (ms). Slightly higher in production builds. */
export const WS_BATCH_MS = import.meta.env.PROD ? 750 : 500;

/** Digital twin canvas target FPS. */
export const TWIN_TARGET_FPS = 24;

/** Max coalesced WS messages per channel before dropping. */
export const WS_QUEUE_MAX = 2;
