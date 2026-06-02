import api from "./api";
import { createEnvLogger } from "../config/env";
import {
  clearAuth,
  getStoredUser,
  getToken,
  isSessionExpired,
  setStoredUser,
  setTokenSession,
} from "../utils/authStorage";

const logger = createEnvLogger("Auth");

/**
 * Authenticate and return token payload.
 * @param {{ email: string, password: string }} credentials
 */
export async function login(credentials) {
  const response = await api.post("/login", credentials);
  logger.debug("login success");
  return response.data;
}

/**
 * Register a new user account (returns JWT on success).
 * @param {{ email: string, password: string, username?: string }} payload
 */
export async function signup(payload) {
  const response = await api.post("/signup", payload);
  logger.debug("signup success");
  return response.data;
}

/** Fetch the authenticated user profile. */
export async function getCurrentUser() {
  const response = await api.get("/me");
  return response.data;
}

/** Returns null on 401 instead of throwing. */
export async function getCurrentUserSafe() {
  try {
    const response = await api.get("/me", { skipAuthRecovery: true });
    return response.data;
  } catch (err) {
    const status = err?.response?.status;
    if (status === 401) {
      logger.debug("no active session");
      return null;
    }
    logger.warn("getCurrentUser failed", status ?? err?.message);
    throw err;
  }
}

/**
 * Persist token + optional user after login/signup.
 * @param {object} tokenPayload TokenResponse from backend
 * @param {object} [user]
 */
export function persistAuthSession(tokenPayload, user) {
  setTokenSession(tokenPayload);
  if (user) setStoredUser(user);
}

/**
 * Login, persist session, and fetch profile.
 * @param {{ email: string, password: string }} credentials
 */
export async function loginAndPersist(credentials) {
  const tokenPayload = await login(credentials);
  persistAuthSession(tokenPayload);

  let user = null;
  try {
    user = await getCurrentUserSafe();
  } catch {
    user = {
      email: credentials.email.trim(),
      username: credentials.email.trim().split("@")[0],
    };
  }
  if (user) setStoredUser(user);
  return { tokenPayload, user };
}

/**
 * Signup, persist session, and fetch profile.
 */
export async function signupAndPersist(payload) {
  const tokenPayload = await signup(payload);
  persistAuthSession(tokenPayload);

  let user = null;
  try {
    user = await getCurrentUserSafe();
  } catch {
    user = {
      email: payload.email,
      username: payload.username || payload.email.split("@")[0],
    };
  }
  if (user) setStoredUser(user);
  return { tokenPayload, user };
}

/**
 * Restore session from storage — validates token + /me.
 * @returns {Promise<object | null>} user profile or null
 */
export async function restoreSession() {
  const token = getToken();
  if (!token || isSessionExpired()) {
    clearAuth();
    return null;
  }

  const cached = getStoredUser();
  try {
    const user = await getCurrentUserSafe();
    if (!user) {
      clearAuth();
      return null;
    }
    setStoredUser(user);
    return user;
  } catch (err) {
    if (cached && !isSessionExpired()) {
      logger.warn("profile fetch failed — using cached user", err?.message);
      return cached;
    }
    clearAuth();
    return null;
  }
}

/** Clear client auth state (call disconnectAllStreams separately). */
export function clearAuthSession() {
  clearAuth();
}
