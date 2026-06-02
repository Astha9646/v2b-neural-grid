/**
 * Neon progress / utilization meter for observability panels.
 */

export function NeonMeter({
  label,
  value = 0,
  max = 100,
  unit = "%",
  accent = "cyan",
  sublabel,
  className = "",
}) {
  const pct = Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : value));

  const accentMap = {
    cyan: {
      bar: "from-cyan-600 via-cyan-400 to-cyan-300",
      glow: "shadow-[0_0_12px_rgba(34,211,238,0.45)]",
      text: "text-cyan-300",
      track: "bg-cyan-950/40",
    },
    emerald: {
      bar: "from-emerald-600 via-emerald-400 to-emerald-300",
      glow: "shadow-[0_0_12px_rgba(52,211,153,0.4)]",
      text: "text-emerald-300",
      track: "bg-emerald-950/40",
    },
    violet: {
      bar: "from-violet-600 via-violet-400 to-violet-300",
      glow: "shadow-[0_0_12px_rgba(167,139,250,0.4)]",
      text: "text-violet-300",
      track: "bg-violet-950/40",
    },
    amber: {
      bar: "from-amber-600 via-amber-400 to-amber-300",
      glow: "shadow-[0_0_12px_rgba(251,191,36,0.35)]",
      text: "text-amber-300",
      track: "bg-amber-950/40",
    },
    rose: {
      bar: "from-rose-600 via-rose-400 to-rose-300",
      glow: "shadow-[0_0_12px_rgba(244,63,94,0.35)]",
      text: "text-rose-300",
      track: "bg-rose-950/40",
    },
  };

  const a = accentMap[accent] ?? accentMap.cyan;
  const display = typeof value === "number" ? value.toFixed(value < 10 ? 1 : 0) : value;

  return (
    <div className={["min-w-0", className].join(" ")}>
      <div className="mb-1.5 flex items-end justify-between gap-2">
        <p className="metric-label truncate">{label}</p>
        <p className={["shrink-0 font-mono text-sm font-bold tabular-nums", a.text].join(" ")}>
          {display}
          <span className="text-[10px] font-medium text-slate-500">{unit}</span>
        </p>
      </div>
      <div className={["h-2 overflow-hidden rounded-full ring-1 ring-white/5", a.track].join(" ")}>
        <div
          className={[
            "h-full rounded-full bg-gradient-to-r transition-all duration-700 ease-out",
            a.bar,
            pct > 2 ? a.glow : "",
          ].join(" ")}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      {sublabel ? <p className="mt-1 truncate text-[10px] text-slate-600">{sublabel}</p> : null}
    </div>
  );
}

export function LatencyMeter({ label, ms = 0, p95 = 0, warnMs = 100, critMs = 250 }) {
  const accent = ms >= critMs ? "rose" : ms >= warnMs ? "amber" : "emerald";
  const cap = Math.max(critMs * 1.2, p95 * 1.1, ms, 1);

  return (
    <div className="min-w-0 rounded-xl border border-white/5 bg-slate-900/40 p-3">
      <NeonMeter label={label} value={ms} max={cap} unit=" ms" accent={accent} />
      <p className="mt-2 text-[10px] text-slate-500">
        p95 <span className="font-mono text-slate-400">{p95.toFixed(1)}</span> ms
      </p>
    </div>
  );
}

export function UptimeCounter({ uptime = "—", uptimeSeconds = 0, status = "operational" }) {
  const statusColor =
    status === "operational"
      ? "text-emerald-300"
      : status === "degraded"
        ? "text-amber-300"
        : "text-rose-300";

  return (
    <div className="min-w-0 rounded-xl border border-cyan-500/15 bg-cyan-500/5 p-4 text-center">
      <p className="metric-label">Platform uptime</p>
      <p className={["mt-2 font-display text-2xl font-bold tabular-nums", statusColor].join(" ")}>
        {uptime}
      </p>
      <p className="mt-1 font-mono text-[10px] text-slate-600">
        {Math.round(uptimeSeconds).toLocaleString()}s since boot
      </p>
    </div>
  );
}
