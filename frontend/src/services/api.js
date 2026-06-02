import axios from "axios";

import env, { createEnvLogger, logEnvConfig } from "../config/env";
import { getToken, getSessionMeta, isSessionExpired, triggerUnauthorized } from "../utils/authStorage";

const logger = createEnvLogger("API");

logEnvConfig();
console.info("[API] base URL", env.apiBaseUrl || "(not configured)");

const AUTH_SKIP_PATHS = ["/login", "/signup"];

function isAuthExempt(url = "") {
  return AUTH_SKIP_PATHS.some((p) => url.includes(p));
}

const api = axios.create({
  baseURL: env.apiBaseUrl,
  headers: {
    "Content-Type": "application/json",
  },
  timeout: env.isProduction ? 30_000 : 60_000,
});

api.interceptors.request.use((config) => {
  const url = config?.url ?? "";
  const token = getToken();
  const hasTrackedSession = Boolean(token || getSessionMeta());

  if (hasTrackedSession && !isAuthExempt(url) && isSessionExpired()) {
    triggerUnauthorized("token_expired");
    return Promise.reject(new axios.CanceledError("Session expired"));
  }

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const url = error?.config?.url ?? "";

    if (status === 401 && !isAuthExempt(url) && !error.config?.skipAuthRecovery) {
      logger.warn("unauthorized request — clearing session", url);
      triggerUnauthorized("unauthorized");
    } else if (env.isDev) {
      logger.debug("request failed", url, status);
    } else if (status && status >= 500) {
      logger.error("server error", url, status);
    }

    return Promise.reject(error);
  },
);

export default api;
