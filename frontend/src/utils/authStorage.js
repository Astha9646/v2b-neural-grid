const TOKEN_KEY = "token";
const TOKEN_LEGACY = "access_token";
const TOKEN_TYPE_KEY = "token_type";
const USER_KEY = "grid_user";
const SESSION_KEY = "auth_session";

/** @typedef {{ expiresAt: number; tokenType: string; savedAt: number }} SessionMeta */

let unauthorizedHandler = null;

/**
 * Register global handler for invalid/expired sessions (401 recovery).
 * @param {((reason: string) => void) | null} handler
 */
export function onUnauthorized(handler) {
  unauthorizedHandler = handler;
}

/**
 * @param {string} [reason]
 */
export function triggerUnauthorized(reason = "session_invalid") {
  unauthorizedHandler?.(reason);
}

function decodeJwtExpMs(token) {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const payload = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    const exp = Number(payload?.exp);
    return Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** @returns {SessionMeta | null} */
export function getSessionMeta() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_LEGACY) || null;
}

/**
 * Persist bearer token + expiry metadata.
 * @param {{ access_token: string; token_type?: string; expires_in?: number }} tokenPayload
 */
export function setTokenSession(tokenPayload) {
  if (!tokenPayload?.access_token) return;

  const { access_token, token_type = "bearer", expires_in } = tokenPayload;
  localStorage.setItem(TOKEN_KEY, access_token);
  localStorage.setItem(TOKEN_LEGACY, access_token);
  localStorage.setItem(TOKEN_TYPE_KEY, token_type);

  const jwtExp = decodeJwtExpMs(access_token);
  const expiresAt =
    jwtExp ??
    Date.now() + (Number.isFinite(expires_in) ? expires_in : 3600) * 1000;

  const meta = {
    expiresAt,
    tokenType: token_type,
    savedAt: Date.now(),
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(meta));
}

/** @deprecated Use setTokenSession */
export function setToken(accessToken) {
  setTokenSession({ access_token: accessToken, expires_in: 3600 });
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_LEGACY);
  localStorage.removeItem(TOKEN_TYPE_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(SESSION_KEY);
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setStoredUser(user) {
  if (!user) {
    localStorage.removeItem(USER_KEY);
    return;
  }
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

/** True when token missing or past expiry (30s clock skew buffer). */
export function isSessionExpired() {
  const token = getToken();
  if (!token) return true;

  const meta = getSessionMeta();
  const expiresAt = meta?.expiresAt ?? decodeJwtExpMs(token);
  if (!expiresAt) return false;

  return Date.now() >= expiresAt - 30_000;
}

/** Milliseconds until expiry, or 0 if expired/missing. */
export function msUntilExpiry() {
  const token = getToken();
  if (!token) return 0;
  const meta = getSessionMeta();
  const expiresAt = meta?.expiresAt ?? decodeJwtExpMs(token);
  if (!expiresAt) return Infinity;
  return Math.max(0, expiresAt - Date.now());
}

export function getDisplayUser(user, loading) {
  if (user?.username) return user.username;
  if (user?.email) return user.email.split("@")[0];
  if (loading) return "Syncing…";
  const stored = getStoredUser();
  if (stored?.username) return stored.username;
  if (stored?.email) return stored.email.split("@")[0];
  return getToken() ? "Grid Operator" : "Guest";
}
