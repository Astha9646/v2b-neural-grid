import { useCallback, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../context/AuthContext";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(value) {
  if (!value.trim()) return "Email is required";
  if (!EMAIL_RE.test(value.trim())) return "Enter a valid email address";
  return "";
}

function validatePassword(value) {
  if (!value) return "Password is required";
  if (value.length < 8) return "Password must be at least 8 characters";
  return "";
}

function BoltIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.15"
      />
    </svg>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-cyan-950/30 border-t-cyan-300"
      aria-hidden
    />
  );
}

function sessionNotice(reason) {
  if (reason === "token_expired") return "Your session expired. Please sign in again.";
  if (reason === "unauthorized") return "Session invalid. Please sign in again.";
  if (reason === "logout") return null;
  return null;
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState({ email: false, password: false });

  const redirectTo = location.state?.from ?? "/dashboard";
  const notice = sessionNotice(location.state?.reason);

  const fieldErrors = useMemo(
    () => ({
      email: touched.email ? validateEmail(email) : "",
      password: touched.password ? validatePassword(password) : "",
    }),
    [email, password, touched],
  );

  const runValidation = useCallback(() => {
    const emailError = validateEmail(email);
    const passwordError = validatePassword(password);
    setTouched({ email: true, password: true });
    return !emailError && !passwordError;
  }, [email, password]);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!runValidation()) return;

    setLoading(true);
    setError("");

    try {
      await login({ email: email.trim(), password });
      navigate(redirectTo, { replace: true });
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(
        typeof detail === "string"
          ? detail
          : Array.isArray(detail)
            ? detail.map((d) => d.msg).join(", ")
            : "Invalid email or password",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      <div className="absolute inset-0 bg-gradient-to-br from-cyan-950 via-black to-emerald-950 opacity-90" />

      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6">
        <div className="mb-10 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-400/30 bg-cyan-500/10 shadow-[0_0_40px_rgba(34,211,238,0.35)]">
            <BoltIcon className="h-8 w-8 text-cyan-400" />
          </div>
          <p className="text-xs uppercase tracking-[0.4em] text-cyan-400">Vehicle-to-Building</p>
          <h1 className="mt-3 text-5xl font-bold tracking-tight">Neural Grid</h1>
          <p className="mt-2 text-lg text-slate-400">AI Smart Charging Command</p>
        </div>

        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur-xl">
          <h2 className="mb-1 text-2xl font-semibold">Sign in</h2>
          <p className="mb-6 text-sm text-slate-400">
            Access your EV fleet &amp; smart-grid dashboard
          </p>

          {notice ? (
            <div className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              {notice}
            </div>
          ) : null}

          {error ? (
            <div className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          ) : null}

          <form onSubmit={handleLogin} className="space-y-5" noValidate>
            <div>
              <label htmlFor="login-email" className="mb-2 block text-sm text-slate-300">
                Email
              </label>
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                placeholder="operator@grid.ai"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                disabled={loading}
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none transition-all duration-300 placeholder:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20 disabled:opacity-60"
              />
              {fieldErrors.email ? (
                <p className="mt-2 text-xs text-red-400">{fieldErrors.email}</p>
              ) : null}
            </div>

            <div>
              <label htmlFor="login-password" className="mb-2 block text-sm text-slate-300">
                Password
              </label>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                disabled={loading}
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none transition-all duration-300 placeholder:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20 disabled:opacity-60"
              />
              {fieldErrors.password ? (
                <p className="mt-2 text-xs text-red-400">{fieldErrors.password}</p>
              ) : null}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 px-4 py-3 font-semibold text-black transition-all duration-300 hover:scale-[1.02] hover:shadow-[0_0_30px_rgba(34,211,238,0.45)] disabled:opacity-60"
            >
              {loading ? (
                <>
                  <Spinner />
                  Connecting…
                </>
              ) : (
                <>
                  <BoltIcon className="h-4 w-4" />
                  Connect to Grid
                </>
              )}
            </button>
          </form>

          <div className="mt-8 text-center">
            <p className="text-xs text-slate-500">Secured by DDPG inference &amp; JWT</p>
            <p className="mt-4 text-sm text-slate-400">
              Don&apos;t have an account?{" "}
              <Link to="/signup" className="text-cyan-400 hover:text-cyan-300">
                Create Account
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
