/**
 * requestAnimationFrame coalescing — at most one callback per display frame.
 */

export function createRafCoalescer(callback) {
  let rafId = null;
  let pending = null;

  const flush = () => {
    rafId = null;
    const value = pending;
    pending = null;
    if (value !== null) {
      callback(value);
    }
  };

  return {
    schedule(value) {
      pending = value;
      if (rafId == null && typeof requestAnimationFrame === "function") {
        rafId = requestAnimationFrame(flush);
      } else if (rafId == null) {
        flush();
      }
    },
    cancel() {
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      pending = null;
    },
    flushNow() {
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      flush();
    },
  };
}

/**
 * Throttle to animation frames (max ~60fps, typically 1 update/frame).
 */
export function createRafThrottle(fn) {
  let rafId = null;
  let lastArgs = null;

  const invoke = () => {
    rafId = null;
    const args = lastArgs;
    lastArgs = null;
    if (args) fn(...args);
  };

  return (...args) => {
    lastArgs = args;
    if (rafId == null && typeof requestAnimationFrame === "function") {
      rafId = requestAnimationFrame(invoke);
    }
  };
}
