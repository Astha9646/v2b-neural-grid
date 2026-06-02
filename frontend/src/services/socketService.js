/**
 * WebSocket client for V2B Neural Grid — one connection per channel, coalesced delivery.
 */

import env, {
  createEnvLogger,
  getSafeWsUrl,
  isWebSocketConfigured,
  logEnvConfig,
  WS_PATHS,
} from "../config/env";
import { WS_QUEUE_MAX } from "../utils/streamConstants";

const logger = createEnvLogger("WS");

const HEARTBEAT_MS = 25_000;
const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;

let wsConfigLogged = false;

export function getWebSocketBaseUrl() {
  if (!wsConfigLogged) {
    logEnvConfig();
    wsConfigLogged = true;
  }
  return env.wsBaseUrl;
}

function buildUrl(path) {
  return getSafeWsUrl(path);
}

function isWebSocketSupported() {
  return typeof WebSocket !== "undefined";
}

class ChannelConnection {
  constructor(channel, onMessage, onStatus) {
    this.channel = channel;
    this.path = WS_PATHS[channel];
    if (!this.path) {
      throw new Error(`Unknown WebSocket channel: ${channel}`);
    }
    this.onMessage = onMessage;
    this.onStatus = onStatus ?? (() => {});
    this.ws = null;
    this.heartbeatId = null;
    this.reconnectId = null;
    this.backoffMs = BASE_BACKOFF_MS;
    this.reconnectAttempts = 0;
    this.intentionalClose = false;
    this.connected = false;
    this.queue = [];
    this.lastSeq = -1;
    this.disabled = false;
  }

  connect() {
    if (this.disabled) {
      return;
    }

    if (!isWebSocketSupported()) {
      logger.error("WebSocket not supported in this environment");
      this.onStatus({ channel: this.channel, state: "unsupported" });
      this.disabled = true;
      return;
    }

    if (!isWebSocketConfigured()) {
      logger.warn("WebSocket not configured — streams disabled", {
        channel: this.channel,
        wsBaseUrl: env.wsBaseUrl,
      });
      this.onStatus({ channel: this.channel, state: "unconfigured" });
      this.disabled = true;
      return;
    }

    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    const url = buildUrl(this.path);
    if (!url) {
      logger.warn("Skipping connect — invalid WebSocket URL", this.path);
      this.onStatus({ channel: this.channel, state: "invalid_url" });
      this.disabled = true;
      return;
    }

    this.intentionalClose = false;
    logger.debug("connecting", this.channel, url);
    this.onStatus({
      channel: this.channel,
      state: "connecting",
      reconnectAttempts: this.reconnectAttempts,
    });

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.connected = true;
        this.backoffMs = BASE_BACKOFF_MS;
        this.reconnectAttempts = 0;
        logger.debug("open", this.channel);
        this.onStatus({ channel: this.channel, state: "open" });
        this._startHeartbeat();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg?.type === "pong") return;

          if (msg?.type === "server_status" && msg?.event === "hello") {
            logger.debug(this.channel, "server hello", msg.reconnect_safe);
          }

          if (msg?.type === "error" && msg?.event === "disabled") {
            logger.warn(this.channel, "server disabled stream", msg.message);
            this.disabled = true;
            this.intentionalClose = true;
            this.ws?.close();
            this.onStatus({ channel: this.channel, state: "server_disabled", message: msg.message });
            return;
          }

          const seq = Number(msg.seq);
          if (Number.isFinite(seq) && seq <= this.lastSeq && msg.event === "tick") {
            return;
          }
          if (Number.isFinite(seq)) this.lastSeq = seq;

          this.queue.push(msg);
          while (this.queue.length > WS_QUEUE_MAX) {
            this.queue.shift();
          }

          const latest = this.queue[this.queue.length - 1];
          logger.debug(this.channel, "packet", latest.event ?? latest.type, "seq", latest.seq);
          this.onMessage(latest);
        } catch (err) {
          logger.warn(`${this.channel} parse error`, err);
        }
      };

      this.ws.onerror = () => {
        this.onStatus({ channel: this.channel, state: "error" });
      };

      this.ws.onclose = () => {
        this.connected = false;
        this._stopHeartbeat();
        this.queue = [];
        logger.debug("closed", this.channel);
        this.onStatus({ channel: this.channel, state: "closed" });
        if (!this.intentionalClose && !this.disabled) this._scheduleReconnect();
      };
    } catch (err) {
      logger.error(`${this.channel} connect failed`, err);
      this._scheduleReconnect();
    }
  }

  disconnect() {
    this.intentionalClose = true;
    this._stopHeartbeat();
    if (this.reconnectId) {
      clearTimeout(this.reconnectId);
      this.reconnectId = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.queue = [];
    this.onStatus({ channel: this.channel, state: "disconnected" });
  }

  sendPing() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "ping", timestamp: new Date().toISOString() }));
    }
  }

  requestResync() {
    if (this.ws?.readyState === WebSocket.OPEN && this.channel === "telemetry") {
      this.lastSeq = -1;
      this.ws.send(JSON.stringify({ type: "resync" }));
    }
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatId = setInterval(() => this.sendPing(), HEARTBEAT_MS);
  }

  _stopHeartbeat() {
    if (this.heartbeatId) {
      clearInterval(this.heartbeatId);
      this.heartbeatId = null;
    }
  }

  _scheduleReconnect() {
    if (this.intentionalClose || this.reconnectId || this.disabled) return;
    this.reconnectAttempts += 1;
    const delay = Math.min(this.backoffMs, MAX_BACKOFF_MS);
    logger.debug("reconnecting", this.channel, "in", delay, "ms", "attempt", this.reconnectAttempts);
    this.onStatus({
      channel: this.channel,
      state: "reconnecting",
      reconnectAttempts: this.reconnectAttempts,
      delayMs: delay,
    });

    this.reconnectId = setTimeout(() => {
      this.reconnectId = null;
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
      this.connect();
    }, delay);
  }
}

const registry = new Map();

export function subscribeChannel(channel, onMessage, onStatus) {
  let entry = registry.get(channel);

  if (!entry) {
    const handlers = new Set();
    const statusHandlers = new Set();
    const conn = new ChannelConnection(
      channel,
      (msg) => handlers.forEach((h) => {
        try {
          h(msg);
        } catch (e) {
          logger.error(`handler error (${channel})`, e);
        }
      }),
      (st) => statusHandlers.forEach((h) => h(st)),
    );
    entry = { conn, handlers, statusHandlers };
    registry.set(channel, entry);
    conn.connect();
  }

  entry.handlers.add(onMessage);
  if (onStatus) entry.statusHandlers.add(onStatus);

  return () => {
    entry.handlers.delete(onMessage);
    if (onStatus) entry.statusHandlers.delete(onStatus);
    if (entry.handlers.size === 0) {
      entry.conn.disconnect();
      registry.delete(channel);
      logger.debug("active connections", registry.size);
    }
  };
}

export function connectGridStreams({ onTelemetry, onForecast, onAi, onStatus } = {}) {
  if (!isWebSocketSupported()) {
    logger.warn("Streams disabled — WebSocket unavailable");
    return () => {};
  }

  if (!isWebSocketConfigured()) {
    logger.warn("Streams disabled — WebSocket not configured", { wsBaseUrl: env.wsBaseUrl });
    onStatus?.({ channel: "all", state: "unconfigured" });
    return () => {};
  }

  logger.debug("connectGridStreams", {
    base: getWebSocketBaseUrl(),
    telemetry: Boolean(onTelemetry),
    forecast: Boolean(onForecast),
    ai: Boolean(onAi),
  });

  const unsubs = [];
  if (onTelemetry) unsubs.push(subscribeChannel("telemetry", onTelemetry, onStatus));
  if (onForecast) unsubs.push(subscribeChannel("forecast", onForecast, onStatus));
  if (onAi) unsubs.push(subscribeChannel("ai", onAi, onStatus));

  return () => {
    unsubs.forEach((u) => u());
    logger.debug("disconnectGridStreams");
  };
}

export function disconnectAllStreams() {
  registry.forEach((entry) => entry.conn.disconnect());
  registry.clear();
}

export function getStreamConnectionStatus() {
  const out = {};
  registry.forEach((entry, ch) => {
    out[ch] = {
      connected: entry.conn.connected,
      readyState: entry.conn.ws?.readyState,
      reconnectAttempts: entry.conn.reconnectAttempts,
      queueDepth: entry.conn.queue.length,
      disabled: entry.conn.disabled,
    };
  });
  logger.debug("active connections", Object.keys(out));
  return out;
}

export function requestTelemetryResync() {
  registry.get("telemetry")?.conn.requestResync();
}

export default {
  getWebSocketBaseUrl,
  subscribeChannel,
  connectGridStreams,
  disconnectAllStreams,
  getStreamConnectionStatus,
  requestTelemetryResync,
};
