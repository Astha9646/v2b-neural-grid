import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { motion } from "framer-motion";

import { useAuth } from "../context/AuthContext";

const FEATURES = [
  { title: "AI Optimization", desc: "DDPG agents orchestrate grid load, EV charging, and storage in real time." },
  { title: "Smart Grid Intelligence", desc: "Geospatial command layer with live stress heatmaps and energy routing." },
  { title: "Renewable Forecasting", desc: "Weather-blended solar irradiance and renewable mix prediction." },
  { title: "EV Fleet Management", desc: "Fleet SOC, charging sessions, and V2G bidirectional flows." },
  { title: "Digital Twin Visualization", desc: "2.5D isometric command center with live energy routing and AI story mode." },
];

function AnimatedCounter({ target, suffix = "" }) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let frame;
    const start = performance.now();
    const duration = 1400;
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      setVal(Math.round(target * p));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return (
    <span>
      {val}
      {suffix}
    </span>
  );
}

export default function LandingPage() {
  const { isAuthenticated } = useAuth();

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="landing-page relative min-h-screen overflow-hidden bg-[#030712] text-slate-100">
      <div className="landing-grid-bg pointer-events-none absolute inset-0 opacity-40" aria-hidden />
      <div className="landing-glow pointer-events-none absolute left-1/2 top-0 h-[480px] w-[800px] -translate-x-1/2 rounded-full bg-cyan-500/10 blur-[120px]" />

      <header className="relative z-10 flex items-center justify-between px-6 py-6 sm:px-10">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/30 bg-cyan-500/10 shadow-neon-cyan">
            <span className="text-lg text-cyan-400">⚡</span>
          </div>
          <div>
            <p className="font-display text-[10px] uppercase tracking-[0.28em] text-cyan-500/80">V2B</p>
            <p className="font-display text-sm font-bold">Neural Grid</p>
          </div>
        </div>
        <Link
          to="/login"
          className="rounded-lg border border-white/10 px-4 py-2 text-xs text-slate-400 transition-colors hover:text-white"
        >
          Sign in
        </Link>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-6 pb-20 pt-8 sm:px-10">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}>
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.35em] text-cyan-400/90">
            AI Smart-Grid Operating System
          </p>
          <h1 className="font-display max-w-3xl text-4xl font-bold leading-tight text-white sm:text-5xl lg:text-6xl">
            Futuristic EV infrastructure command center
          </h1>
          <p className="mt-5 max-w-2xl text-base text-slate-400 sm:text-lg">
            Real-time telemetry, RL optimization, geospatial intelligence, and cinematic digital twins — unified in
            one production-grade platform.
          </p>

          <div className="mt-8 flex flex-wrap gap-4">
            <Link
              to="/login"
              className="group relative overflow-hidden rounded-xl border border-cyan-400/40 bg-cyan-500/15 px-8 py-3.5 text-sm font-semibold text-cyan-100 shadow-[0_0_40px_rgba(34,211,238,0.2)] transition-all hover:shadow-[0_0_56px_rgba(34,211,238,0.35)]"
            >
              Enter Neural Grid
            </Link>
            <Link
              to="/signup"
              className="rounded-xl border border-white/10 px-8 py-3.5 text-sm font-semibold text-slate-300 transition-colors hover:border-white/20 hover:text-white"
            >
              Create account
            </Link>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.7 }}
          className="mt-14 grid grid-cols-2 gap-4 sm:grid-cols-4"
        >
          <StatCard label="Grid Load" value={<AnimatedCounter target={847} suffix=" kW" />} />
          <StatCard label="Renewable Mix" value={<AnimatedCounter target={68} suffix="%" />} accent />
          <StatCard label="Active EV Sessions" value={<AnimatedCounter target={24} />} />
          <StatCard label="AI Agents Online" value={<AnimatedCounter target={8} />} accent />
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.45 }}
          className="mt-6 flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-300/90"
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          Neural Grid AI · Systems nominal · Live telemetry ready
        </motion.div>

        <section className="mt-20">
          <h2 className="mb-8 font-display text-xl font-semibold text-white">Platform capabilities</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <motion.article
                key={f.title}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.06 }}
                className="landing-feature glass-viz rounded-2xl border border-white/[0.06] p-5 transition-all hover:border-cyan-400/20 hover:shadow-[0_0_30px_rgba(34,211,238,0.06)]"
              >
                <h3 className="font-display text-sm font-semibold text-cyan-200">{f.title}</h3>
                <p className="mt-2 text-sm text-slate-400">{f.desc}</p>
              </motion.article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function StatCard({ label, value, accent = false }) {
  return (
    <div className="glass-viz rounded-xl border border-white/[0.06] px-4 py-3">
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${accent ? "text-emerald-300" : "text-cyan-200"}`}>{value}</p>
    </div>
  );
}
