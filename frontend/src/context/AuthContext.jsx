import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";

import {
  clearAuthSession,
  loginAndPersist,
  restoreSession,
  signupAndPersist,
} from "../services/authService";
import { disconnectAllStreams } from "../services/socketService";
import {
  getStoredUser,
  isSessionExpired,
  msUntilExpiry,
  onUnauthorized,
  clearAuth,
} from "../utils/authStorage";
import { createEnvLogger } from "../config/env";

const logger = createEnvLogger("AuthContext");

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState("loading");
  const [user, setUser] = useState(null);
  const restoreStarted = useRef(false);
  const expiryTimerRef = useRef(null);

  const logout = useCallback(
    (reason = "logout") => {
      logger.info("logout", reason);
      if (expiryTimerRef.current) {
        clearTimeout(expiryTimerRef.current);
        expiryTimerRef.current = null;
      }
      disconnectAllStreams();
      clearAuthSession();
      setUser(null);
      setStatus("unauthenticated");
      navigate("/login", { replace: true, state: { reason } });
    },
    [navigate],
  );

  const scheduleExpiryLogout = useCallback(() => {
    if (expiryTimerRef.current) {
      clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = null;
    }
    const ms = msUntilExpiry();
    if (!Number.isFinite(ms) || ms <= 0) return;
    expiryTimerRef.current = setTimeout(() => {
      if (isSessionExpired()) logout("token_expired");
    }, Math.min(ms + 500, 24 * 60 * 60 * 1000));
  }, [logout]);

  const completeAuth = useCallback(
    (profile) => {
      setUser(profile);
      setStatus("authenticated");
      scheduleExpiryLogout();
    },
    [scheduleExpiryLogout],
  );

  const login = useCallback(
    async (credentials) => {
      const { user: profile } = await loginAndPersist(credentials);
      completeAuth(profile);
      return profile;
    },
    [completeAuth],
  );

  const signup = useCallback(
    async (payload) => {
      const { user: profile } = await signupAndPersist(payload);
      completeAuth(profile);
      return profile;
    },
    [completeAuth],
  );

  useEffect(() => {
    onUnauthorized((reason) => logout(reason));
    return () => onUnauthorized(null);
  }, [logout]);

  useEffect(() => {
    if (restoreStarted.current) return;
    restoreStarted.current = true;

    let cancelled = false;

    (async () => {
      const cached = getStoredUser();
      if (cached) setUser(cached);

      if (isSessionExpired()) {
        clearAuth();
        if (!cancelled) {
          setUser(null);
          setStatus("unauthenticated");
        }
        return;
      }

      try {
        const profile = await restoreSession();
        if (cancelled) return;
        if (profile) {
          completeAuth(profile);
        } else {
          setUser(null);
          setStatus("unauthenticated");
        }
      } catch (err) {
        logger.warn("session restore failed", err?.message);
        if (!cancelled) {
          clearAuth();
          setUser(null);
          setStatus("unauthenticated");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [completeAuth]);

  useEffect(() => {
    if (status !== "authenticated") return undefined;
    const id = setInterval(() => {
      if (isSessionExpired()) logout("token_expired");
    }, 60_000);
    return () => clearInterval(id);
  }, [status, logout]);

  const value = useMemo(
    () => ({
      status,
      user,
      isAuthenticated: status === "authenticated",
      isLoading: status === "loading",
      login,
      signup,
      logout: () => logout("logout"),
      sessionKey: user?.id ?? "guest",
    }),
    [status, user, login, signup, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}

export default AuthContext;
