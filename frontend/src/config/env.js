/**
 * V2B Neural Grid — centralized frontend environment configuration.
 *
 * Primary variables:
 *   VITE_API_URL       — REST API base (required in production / Vercel)
 *   VITE_WS_URL        — WebSocket base (required on Vercel — no same-origin WS proxy)
 *   VITE_ENVIRONMENT   — development | staging | production
 *
 * Legacy aliases (still supported):
 *   VITE_API_BASE_URL → VITE_API_URL
 *   VITE_WS_BASE_URL  → VITE_WS_URL
 *   VITE_APP_ENV → VITE_ENVIRONMENT
 *
 * Vercel: set VITE_API_URL and VITE_WS_URL to your backend URLs
 * in the Vercel project Environment Variables dashboard.
 */

const vite = import.meta.env;

const LOG_LEVELS = Object.freeze({
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 99,
});

const DEFAULT_PROD_API_URL = "https://v2b-neural-grid-1.onrender.com";
const DEFAULT_PROD_WS_URL = "wss://v2b-neural-grid-1.onrender.com";

function trimSlash(value) {
  if (!value) return "";
  return String(value).replace(/\/+$/, "");
}

function stripQuotes(value) {
  if (!value) return "";
  const s = String(value).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function readEnv(key, fallback = "") {
  const value = vite[key] ?? fallback;
  return value === undefined || value === null ? "" : stripQuotes(value);
}

function resolveEnvironment() {
  const explicit = readEnv("VITE_ENVIRONMENT") || readEnv("VITE_APP_ENV");
  if (explicit) return explicit.toLowerCase();
  if (vite.PROD) return "production";
  if (vite.DEV) return "development";
  return (vite.MODE || "development").toLowerCase();
}

const environment = resolveEnvironment();
const isDev = environment === "development" && vite.DEV === true;
const isStaging = environment === "staging";
const isProduction =
  environment === "production" || (vite.PROD === true && !isDev && !isStaging);

const logLevelName = (readEnv("VITE_LOG_LEVEL") || (isDev ? "debug" : "warn")).toLowerCase();
const logLevel = LOG_LEVELS[logLevelName] ?? LOG_LEVELS.warn;

function shouldLog(level) {
  return (LOG_LEVELS[level] ?? LOG_LEVELS.info) >= logLevel;
}

/** True when running on Vercel (build flag or deployed hostname). */
export function isVercelDeployment() {
  if (readEnv("VITE_VERCEL") === "1" || readEnv("VERCEL") === "1") {
    return true;
  }
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    return host.endsWith(".vercel.app") || host.endsWith(".vercel.sh");
  }
  return false;
}

/**
 * Environment-aware logger — suppresses debug noise in production.
 * @param {string} scope
 */
export function createEnvLogger(scope = "App") {
  const prefix = `[${scope}]`;
  return {
    debug: (...args) => {
      if (shouldLog("debug")) console.debug(prefix, ...args);
    },
    info: (...args) => {
      if (shouldLog("info")) console.info(prefix, ...args);
    },
    warn: (...args) => {
      if (shouldLog("warn")) console.warn(prefix, ...args);
    },
    error: (...args) => {
      if (shouldLog("error")) console.error(prefix, ...args);
    },
  };
}

export const envLogger = createEnvLogger("Env");

function devApiBaseUrl() {
  const devHost = readEnv("VITE_DEV_API_HOST", "127.0.0.1");
  const devPort = readEnv("VITE_DEV_API_PORT", "8001");
  return `http://${devHost}:${devPort}`;
}

function devWsBaseUrl() {
  const wsHost = readEnv("VITE_WS_HOST") || readEnv("VITE_DEV_API_HOST", "127.0.0.1");
  const wsPort = readEnv("VITE_WS_PORT") || readEnv("VITE_DEV_API_PORT", "8001");
  const wsProtocol = readEnv("VITE_WS_PROTOCOL") || "ws";
  return `${wsProtocol}://${wsHost}:${wsPort}`;
}

function resolveApiBaseUrl() {
  const explicit = readEnv("VITE_API_URL") || readEnv("VITE_API_BASE_URL");
  if (explicit) return trimSlash(explicit);

  const host = readEnv("VITE_API_HOST");
  const port = readEnv("VITE_API_PORT");
  const protocol = readEnv("VITE_API_PROTOCOL", "http");
  if (host || port) {
    const h = host || readEnv("VITE_DEV_API_HOST", "127.0.0.1");
    const p = port || readEnv("VITE_DEV_API_PORT", "8001");
    return `${protocol}://${h}:${p}`;
  }

  // Local Vite dev server only — never assume localhost in production builds
  if (isDev) {
    return devApiBaseUrl();
  }

  // Docker/nginx same-origin proxy (not Vercel)
  if (isProduction && !isVercelDeployment() && typeof window !== "undefined") {
    return DEFAULT_PROD_API_URL;
  }

  return isProduction ? DEFAULT_PROD_API_URL : "";
}

function httpToWs(httpUrl) {
  return httpUrl.replace(/^http/i, (m) => (m.toLowerCase() === "https" ? "wss" : "ws"));
}

function resolveWsBaseUrl(apiBaseUrl) {
  const explicit = readEnv("VITE_WS_URL") || readEnv("VITE_WS_BASE_URL");
  if (explicit) return trimSlash(explicit);

  if (apiBaseUrl.startsWith("http://") || apiBaseUrl.startsWith("https://")) {
    return trimSlash(httpToWs(apiBaseUrl));
  }

  // Local dev only
  if (isDev) {
    return devWsBaseUrl();
  }

  // Same-origin WS works behind nginx/docker — not on Vercel static hosting
  if (
    isProduction &&
    !isVercelDeployment() &&
    typeof window !== "undefined" &&
    window.location?.host
  ) {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return DEFAULT_PROD_WS_URL || `${proto}//${window.location.host}`;
  }

  return isProduction ? DEFAULT_PROD_WS_URL : "";
}

const apiBaseUrl = resolveApiBaseUrl();
const wsBaseUrl = resolveWsBaseUrl(apiBaseUrl);

/** WebSocket channel paths (relative to ws base). */
export const WS_PATHS = Object.freeze({
  telemetry: readEnv("VITE_WS_TELEMETRY_PATH", "/ws/telemetry"),
  forecast: readEnv("VITE_WS_FORECAST_PATH", "/ws/forecast"),
  ai: readEnv("VITE_WS_AI_PATH", "/ws/ai"),
});

export const env = Object.freeze({
  environment,
  mode: environment,
  isDev,
  isStaging,
  isProduction,
  isVercel: isVercelDeployment(),
  apiBaseUrl,
  wsBaseUrl,
  wsPaths: WS_PATHS,
  logLevel: logLevelName,
});

/**
 * Validate runtime configuration; returns issues without throwing.
 */
export function validateEnvConfig() {
  const issues = [];

  if (!apiBaseUrl) {
    issues.push("VITE_API_URL is required in production (e.g. https://your-api-host)");
  }

  if (!wsBaseUrl) {
    issues.push("VITE_WS_URL is required for telemetry/forecast/AI streams in production");
  }

  const localhostPattern = /^https?:\/\/(localhost|127\.0\.0\.1)/i;
  const localWsPattern = /^ws:\/\/(localhost|127\.0\.0\.1)/i;

  if (isProduction && localhostPattern.test(apiBaseUrl)) {
    issues.push("Production API must not use localhost — set VITE_API_URL to your hosted backend");
  }

  if (isProduction && localWsPattern.test(wsBaseUrl)) {
    issues.push("Production WebSocket must not use ws://localhost — set VITE_WS_URL=wss://...");
  }

  if (isProduction && wsBaseUrl.startsWith("ws://") && !readEnv("VITE_WS_URL")) {
    issues.push("Use wss:// for production WebSocket connections");
  }

  if (isVercelDeployment() && !readEnv("VITE_WS_URL") && !wsBaseUrl.startsWith("wss://")) {
    issues.push(
      "Vercel static hosting cannot proxy WebSockets — set VITE_WS_URL=wss://your-backend",
    );
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Build absolute or root-relative API path.
 * @param {string} path e.g. "/health"
 */
export function apiUrl(path = "") {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (!apiBaseUrl) {
    envLogger.warn("apiUrl called without configured API base", path);
    return p;
  }
  if (apiBaseUrl.startsWith("http")) {
    return `${apiBaseUrl}${p}`;
  }
  return `${apiBaseUrl}${p}`;
}

/**
 * Build full WebSocket URL for a channel path.
 * @param {string} path e.g. "/ws/telemetry"
 */
export function wsUrl(path) {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (!wsBaseUrl) {
    envLogger.warn("wsUrl called without configured WS base", path);
    return p;
  }
  return `${wsBaseUrl}${p}`;
}

/**
 * Returns a validated WebSocket URL or null when unsafe / unconfigured.
 * @param {string} path
 */
export function getSafeWsUrl(path) {
  if (typeof WebSocket === "undefined") {
    return null;
  }
  const url = wsUrl(path);
  if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
    envLogger.warn("Invalid WebSocket URL scheme", url);
    return null;
  }
  if (isProduction && url.startsWith("ws://")) {
    envLogger.warn("Insecure ws:// in production — set VITE_WS_URL=wss://...");
    if (isVercelDeployment()) return null;
  }
  return url;
}

export function isWebSocketConfigured() {
  return Boolean(wsBaseUrl && getSafeWsUrl(WS_PATHS.telemetry));
}

export function logEnvConfig() {
  const validation = validateEnvConfig();
  const payload = {
    environment: env.environment,
    isVercel: env.isVercel,
    apiBaseUrl: env.apiBaseUrl,
    wsBaseUrl: env.wsBaseUrl,
    wsPaths: env.wsPaths,
    logLevel: env.logLevel,
    validation,
  };
  if (isDev) {
    envLogger.debug("V2B Neural Grid frontend config", payload);
  } else if (!validation.ok) {
    envLogger.warn("Environment configuration issues", validation.issues);
  } else {
    envLogger.info("Frontend config ready", {
      environment: env.environment,
      apiBaseUrl: env.apiBaseUrl,
      wsBaseUrl: env.wsBaseUrl,
    });
  }
}

export default env;
