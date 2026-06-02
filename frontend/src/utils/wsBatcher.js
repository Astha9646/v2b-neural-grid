import { createRafCoalescer } from "./rafScheduler";

/**
 * Coalesce high-frequency WebSocket handlers into a single flush callback.
 * Uses rAF when available, then falls back to timer debounce.
 */
export function createWsBatcher(flushFn, intervalMs = 500) {
  let timer = null;
  const pending = {
    telemetry: null,
    forecast: null,
    ai: null,
  };

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const batch = { ...pending };
    pending.telemetry = null;
    pending.forecast = null;
    pending.ai = null;
    if (batch.telemetry || batch.forecast || batch.ai) {
      flushFn(batch);
    }
  };

  const rafGate =
    typeof requestAnimationFrame === "function"
      ? createRafCoalescer(() => {
          if (timer) return;
          timer = setTimeout(() => {
            timer = null;
            flush();
          }, Math.max(0, intervalMs - 16));
        })
      : null;

  const schedule = () => {
    if (rafGate) {
      rafGate.schedule(true);
      return;
    }
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, intervalMs);
  };

  return {
    pushTelemetry(msg) {
      pending.telemetry = msg;
      schedule();
    },
    pushForecast(msg) {
      pending.forecast = msg;
      schedule();
    },
    pushAi(msg) {
      pending.ai = msg;
      schedule();
    },
    cancel() {
      rafGate?.cancel();
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pending.telemetry = null;
      pending.forecast = null;
      pending.ai = null;
    },
    flushNow() {
      rafGate?.cancel();
      flush();
    },
  };
}
