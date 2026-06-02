import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "../context/AuthContext";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(value) {
  if (!value.trim()) return "Email is required";
  if (!EMAIL_RE.test(value.trim())) return "Enter a valid email address";
  return "";
}

function validateUsername(value) {
  if (!value.trim()) return "Username is required";
  if (value.trim().length < 3) return "Username must be at least 3 characters";
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

export default function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState({
    username: false,
    email: false,
    password: false,
    confirmPassword: false,
  });

  const fieldErrors = useMemo(
    () => ({
      username: touched.username ? validateUsername(username) : "",
      email: touched.email ? validateEmail(email) : "",
      password: touched.password ? validatePassword(password) : "",
      confirmPassword:
        touched.confirmPassword && password !== confirmPassword
          ? "Passwords do not match"
          : "",
    }),
    [username, email, password, confirmPassword, touched],
  );

  const runValidation = useCallback(() => {
    setTouched({
      username: true,
      email: true,
      password: true,
      confirmPassword: true,
    });
    return (
      !validateUsername(username) &&
      !validateEmail(email) &&
      !validatePassword(password) &&
      password === confirmPassword
    );
  }, [username, email, password, confirmPassword]);

  const handleSignup = async (e) => {
    e.preventDefault();
    setError("");
    if (!runValidation()) {
      if (password !== confirmPassword) setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      await signup({
        username: username.trim(),
        email: email.trim(),
        password,
      });
      navigate("/dashboard", { replace: true });
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(
        typeof detail === "string"
          ? detail
          : Array.isArray(detail)
            ? detail.map((d) => d.msg).join(", ")
            : "Signup failed — please try again",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      <div className="absolute inset-0 bg-gradient-to-br from-cyan-950 via-black to-emerald-950 opacity-90" />

      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 py-10">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-400/30 bg-cyan-500/10 shadow-[0_0_40px_rgba(34,211,238,0.35)]">
            <BoltIcon className="h-7 w-7 text-cyan-400" />
          </div>
          <p className="text-xs uppercase tracking-[0.35em] text-cyan-400">Neural Grid</p>
        </div>

        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur-xl">
          <h1 className="mb-1 text-2xl font-semibold">Create Account</h1>
          <p className="mb-6 text-sm text-slate-400">Join the V2B AI smart-grid platform</p>

          {error ? (
            <div className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          ) : null}

          <form onSubmit={handleSignup} className="space-y-4" noValidate>
            <div>
              <label htmlFor="signup-username" className="mb-2 block text-sm text-slate-300">
                Username
              </label>
              <input
                id="signup-username"
                type="text"
                autoComplete="username"
                placeholder="grid_operator"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, username: true }))}
                disabled={loading}
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none transition-all duration-300 placeholder:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20 disabled:opacity-60"
              />
              {fieldErrors.username ? (
                <p className="mt-2 text-xs text-red-400">{fieldErrors.username}</p>
              ) : null}
            </div>

            <div>
              <label htmlFor="signup-email" className="mb-2 block text-sm text-slate-300">
                Email
              </label>
              <input
                id="signup-email"
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
              <label htmlFor="signup-password" className="mb-2 block text-sm text-slate-300">
                Password
              </label>
              <input
                id="signup-password"
                type="password"
                autoComplete="new-password"
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

            <div>
              <label htmlFor="signup-confirm" className="mb-2 block text-sm text-slate-300">
                Confirm Password
              </label>
              <input
                id="signup-confirm"
                type="password"
                autoComplete="new-password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, confirmPassword: true }))}
                disabled={loading}
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none transition-all duration-300 placeholder:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20 disabled:opacity-60"
              />
              {fieldErrors.confirmPassword ? (
                <p className="mt-2 text-xs text-red-400">{fieldErrors.confirmPassword}</p>
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
                  Creating account…
                </>
              ) : (
                <>
                  <BoltIcon className="h-4 w-4" />
                  Create Account
                </>
              )}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-400">
            Already have an account?{" "}
            <Link to="/login" className="text-cyan-400 hover:text-cyan-300">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
