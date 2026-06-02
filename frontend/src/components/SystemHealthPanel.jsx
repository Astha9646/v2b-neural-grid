import { memo, useMemo } from "react";

import { useObservability } from "../context/ObservabilityContext";

// ---------------------------------------------------------------------------
// Fallback when observability API unavailable
// ---------------------------------------------------------------------------

const FALLBACK_HEALTH = {
  overall: "degraded",
  lastChecked: new Date().toISOString(),
  uptimePct: 99.0,
  uptimeLabel: "—",
  services: [
    {
      id: "api",
      name: "Backend API",
      status: "degraded",
      latencyMs: 0,
      detail: "Awaiting /system/health",
    },
  ],
};

const STAGGER_MS = [0, 70, 140, 210, 280];

const STATUS_STYLES = {
  online: {
    label: "Online",
    dot: "bg-emerald-400 glow-dot-emerald",
    ping: "bg-emerald-400",
    border: "border-emerald-500/25 hover:border-emerald-400/45",
    glow: "hover:shadow-[0_0_16px_rgba(52,211,153,0.08)]",
    badge: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/35",
    icon: "text-emerald-400 bg-emerald-500/10 ring-emerald-500/30",
    latency: "text-emerald-300",
  },
  degraded: {
    label: "Degraded",
    dot: "bg-amber-400 glow-dot-amber",
    ping: "bg-amber-400",
    border: "border-amber-500/30 hover:border-amber-400/45",
    glow: "hover:shadow-[0_0_32px_rgba(251,191,36,0.14)]",
    badge: "bg-amber-500/15 text-amber-300 ring-amber-500/35",
    icon: "text-amber-400 bg-amber-500/10 ring-amber-500/30",
    latency: "text-amber-300",
  },
  offline: {
    label: "Offline",
    dot: "bg-rose-400",
    ping: "bg-rose-400",
    border: "border-rose-500/30 hover:border-rose-400/45",
    glow: "hover:shadow-[0_0_32px_rgba(244,63,94,0.14)]",
    badge: "bg-rose-500/15 text-rose-300 ring-rose-500/35",
    icon: "text-rose-400 bg-rose-500/10 ring-rose-500/30",
    latency: "text-rose-300",
  },
};

function ServerIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="4" width="16" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="4" y="14" width="16" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="7" r="1" fill="currentColor" />
      <circle cx="8" cy="17" r="1" fill="currentColor" />
    </svg>
  );
}

function BrainIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2a4 4 0 014 4v1h1a3 3 0 013 3v2a3 3 0 01-3 3h-1v1a4 4 0 01-8 0v-1H7a3 3 0 01-3-3v-2a3 3 0 013-3h1V6a4 4 0 014-4z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function BoltIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function NetworkIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="5" r="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="5" cy="19" r="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="19" cy="19" r="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 7v4M12 11l-7 6M12 11l7 6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function TrendIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 18l5-6 4 3 7-10 4 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const SERVICE_ICONS = {
  api: ServerIcon,
  model: BrainIcon,
  inference: BoltIcon,
  forecast: TrendIcon,
  streams: NetworkIcon,
  database: ServerIcon,
};

function StatusPulse({ status, pulse = true }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.offline;
  return (
    <span className="relative flex h-3 w-3 shrink-0" title={s.label}>
      {pulse && status !== "offline" ? (
        <span
          className={[
            "absolute inline-flex h-full w-full animate-ping rounded-full opacity-50",
            s.ping,
          ].join(" ")}
        />
      ) : null}
      <span className={["relative inline-flex h-3 w-3 rounded-full", s.dot].join(" ")} />
    </span>
  );
}

function ServiceRow({ service, index }) {
  const s = STATUS_STYLES[service.status] ?? STATUS_STYLES.offline;
  const Icon = SERVICE_ICONS[service.id] ?? ServerIcon;

  return (
    <article
      className={[
        "flex min-w-0 items-center gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5",
        "transition-colors duration-200 hover:bg-white/[0.04]",
        "animate-fade-in-up opacity-0",
      ].join(" ")}
      style={{
        animationDelay: `${STAGGER_MS[index] ?? 0}ms`,
        animationFillMode: "forwards",
      }}
    >
      <div className={["flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1", s.icon].join(" ")}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h4 className="truncate text-sm font-semibold text-slate-200">{service.name}</h4>
          <StatusPulse status={service.status} pulse={false} />
        </div>
        <p className="truncate text-[11px] text-slate-500">{service.detail}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className={["font-mono text-sm font-bold tabular-nums", s.latency].join(" ")}>
          {service.latencyMs}
          <span className="text-[10px] font-medium text-slate-500">
            {service.id === "streams" ? "/s" : " ms"}
          </span>
        </p>
        {service.latencyP99Ms != null ? (
          <p className="text-[10px] text-slate-600">p99 {service.latencyP99Ms}ms</p>
        ) : null}
      </div>
    </article>
  );
}

const VISIBLE_SERVICE_IDS = ["api", "model", "inference", "forecast", "streams"];

function SystemHealthPanelInner({ health: healthOverride, className = "", compact = false }) {
  const { panelHealth, loading, error, refresh } = useObservability();

  const health = healthOverride ?? panelHealth ?? FALLBACK_HEALTH;

  const services = useMemo(
    () => (health.services ?? []).filter((s) => VISIBLE_SERVICE_IDS.includes(s.id)),
    [health.services],
  );

  const avgLatency = useMemo(() => {
    const latencyServices = services.filter((s) => s.id !== "streams");
    if (!latencyServices.length) return "—";
    const sum = latencyServices.reduce((acc, s) => acc + (s.latencyMs || 0), 0);
    return (sum / latencyServices.length).toFixed(1);
  }, [services]);

  const overallStatus =
    health.overall === "operational"
      ? "online"
      : health.overall === "critical"
        ? "offline"
        : "degraded";

  return (
    <section className={["relative min-w-0", className].join(" ")} aria-labelledby="system-health-title">
      <div className="panel-shell panel-shell-accent h-full">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/25 to-cyan-400/25"
          aria-hidden
        />

        <header className="relative mb-4 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 ring-1 ring-emerald-400/20">
              <ServerIcon className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <p className="section-eyebrow text-emerald-500/70">Infrastructure</p>
              <h2 id="system-health-title" className="truncate text-base font-semibold text-white">
                System Health
              </h2>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Uptime</p>
            <p className="font-mono text-sm font-semibold tabular-nums text-cyan-200/90">
              {health.uptimeLabel ?? `${health.uptimePct}%`}
            </p>
          </div>
        </header>

        <div className="mb-4 flex min-w-0 items-center gap-2 rounded-lg border border-white/10 bg-slate-900/30 px-3 py-2">
          <StatusPulse status={overallStatus} pulse={!compact} />
          <span className="truncate text-xs capitalize text-slate-400">{health.overall ?? "syncing"}</span>
          <button
            type="button"
            onClick={refresh}
            className="ml-auto shrink-0 text-[10px] font-semibold uppercase tracking-wider text-cyan-500/80 hover:text-cyan-300"
          >
            Sync
          </button>
        </div>

        {error && !healthOverride ? (
          <p className="mb-3 text-[11px] text-amber-400/90">{error}</p>
        ) : null}

        {loading && !panelHealth && !healthOverride ? (
          <div className="space-y-2 animate-pulse">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-12 rounded-lg bg-slate-800/40" />
            ))}
          </div>
        ) : (
          <div className="relative space-y-2">
            {services.map((service, index) => (
              <ServiceRow key={service.id} service={service} index={index} />
            ))}
          </div>
        )}

        <footer className="relative mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-3 text-[10px] text-slate-600">
          <span>
            Probe{" "}
            {new Date(health.lastChecked).toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <span className="font-mono text-slate-500">avg {avgLatency} ms</span>
        </footer>
      </div>
    </section>
  );
}

const SystemHealthPanel = memo(SystemHealthPanelInner);
SystemHealthPanel.displayName = "SystemHealthPanel";

export default SystemHealthPanel;
