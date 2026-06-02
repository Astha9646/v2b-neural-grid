import api from "./api";
import env, { createEnvLogger } from "../config/env";
import {
  clearAuth,
  getStoredUser,
  getToken,
  isSessionExpired,
  setStoredUser,
  setTokenSession,
} from "../utils/authStorage";

const logger = createEnvLogger("Auth");

/** Production Render API (signup uses this when env is unset or localhost). */
const PRODUCTION_API_URL = "https://v2b-neural-grid-1.onrender.com";

function resolveSignupBaseUrl() {
  const configured = (env.apiBaseUrl || "").replace(/\/+$/, "");
  if (env.isDev) {
    return configured || "http://127.0.0.1:8001";
  }
  if (configured && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configured)) {
    return configured;
  }
  return PRODUCTION_API_URL;
}

function buildSignupBody(payload) {
  return {
    username: String(payload?.username ?? "").trim(),
    email: String(payload?.email ?? "")
      .trim()
      .toLowerCase(),
    password: String(payload?.password ?? ""),
  };
}

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
 * POST { email, password, username } to production or configured API base.
 * @param {{ email: string, password: string, username: string }} payload
 */
export async function signup(payload) {
  const body = buildSignupBody(payload);
  const baseURL = resolveSignupBaseUrl();
  console.info("[Auth] signup request", { ...body, password: "[redacted]" });
  console.info("[Auth] signup API URL", `${baseURL}/signup`);

  const response = await api.post("/signup", body, { baseURL });
  console.info("[Auth] signup response", response?.data);
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
  const responseUser = tokenPayload?.user ?? null;
  persistAuthSession(tokenPayload, responseUser);

  let user = responseUser;
  try {
    if (!user) user = await getCurrentUserSafe();
  } catch {
    if (!user) {
      user = {
        email: credentials.email.trim(),
        username: credentials.email.trim().split("@")[0],
      };
    }
  }
  if (user) setStoredUser(user);
  return { tokenPayload, user };
}

/**
 * Signup, persist session, and fetch profile (same session path as login).
 */
export async function signupAndPersist(payload) {
  const body = buildSignupBody(payload);
  const tokenPayload = await signup(body);

  if (!tokenPayload?.access_token) {
    throw new Error("Signup did not return an access token");
  }

  const responseUser = tokenPayload.user ?? null;
  persistAuthSession(tokenPayload, responseUser);

  let user = responseUser;
  if (!user) {
    try {
      user = await getCurrentUserSafe();
    } catch {
      /* use fallback below */
    }
  }
  if (!user) {
    user = {
      email: body.email,
      username: body.username || body.email.split("@")[0],
      is_active: true,
    };
  }
  setStoredUser(user);
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
