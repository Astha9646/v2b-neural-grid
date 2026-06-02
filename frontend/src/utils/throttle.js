/**
 * Throttle state updates for high-frequency WebSocket streams.
 */
export function createThrottle(ms = 400) {
  let last = 0;
  let timer = null;
  let pending = null;

  const run = (fn) => {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn();
      return;
    }
    pending = fn;
    if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        if (pending) {
          pending();
          pending = null;
        }
      }, ms - (now - last));
    }
  };

  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  };

  return { run, cancel };
}
