import { useCallback, useEffect, useMemo, useState } from "react";

import { getDisplayUser } from "../utils/authStorage";
import { useAuth } from "../context/AuthContext";
import { apiUrl } from "../config/env";

const DEFAULT_CHARGERS = 8;

function formatLiveTime(date) {
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function UserIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M5 20c0-3.3 3.1-6 7-6s7 2.7 7 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChargerIcon({ className }) {
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

function StatusIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12 7v5l3 2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ClockIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12 8v4l2.5 2.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function StatPill({ icon: Icon, label, value, subValue, accent = "cyan", className = "" }) {
  const accentMap = {
    cyan: {
      ring: "ring-cyan-500/20",
      bg: "bg-cyan-500/10",
      text: "text-cyan-300",
      icon: "text-cyan-400",
      glow: "shadow-[0_0_20px_rgba(34,211,238,0.12)]",
    },
    emerald: {
      ring: "ring-emerald-500/20",
      bg: "bg-emerald-500/10",
      text: "text-emerald-300",
      icon: "text-emerald-400",
      glow: "shadow-[0_0_20px_rgba(52,211,153,0.12)]",
    },
    amber: {
      ring: "ring-amber-500/20",
      bg: "bg-amber-500/10",
      text: "text-amber-300",
      icon: "text-amber-400",
      glow: "shadow-[0_0_20px_rgba(251,191,36,0.1)]",
    },
  };
  const a = accentMap[accent] ?? accentMap.cyan;

  return (
    <div
      className={[
        "flex min-w-0 items-center gap-2.5 rounded-xl border border-white/5 px-3 py-2 sm:gap-3 sm:px-4 sm:py-2.5",
        "bg-white/[0.03] backdrop-blur-md transition-all duration-300 hover:border-cyan-500/20 hover:bg-white/[0.05]",
        a.ring,
        a.glow,
        className,
      ].join(" ")}
    >
      <span
        className={[
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ring-white/5",
          a.bg,
        ].join(" ")}
      >
        <Icon className={["h-[18px] w-[18px]", a.icon].join(" ")} />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {label}
        </p>
        <p className={["truncate text-sm font-semibold sm:text-base", a.text].join(" ")}>
          {value}
        </p>
        {subValue ? (
          <p className="truncate text-[11px] text-slate-500">{subValue}</p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Top control-center navbar for the Neural Grid dashboard.
 *
 * @param {object} [props]
 * @param {string} [props.title] - Page title (left on desktop)
 * @param {object} [props.user] - `{ username, email }` override
 * @param {number} [props.activeChargers] - Connected / active EVSE count
 * @param {number} [props.totalChargers] - Fleet size
 * @param {string} [props.systemStatus] - e.g. "Operational", "Degraded"
 * @param {boolean} [props.modelLoaded] - RL model readiness
 * @param {string} [props.className]
 */
export default function Navbar({
  title = "Command Center",
  user: userOverride,
  activeChargers: activeOverride,
  totalChargers = DEFAULT_CHARGERS,
  systemStatus: statusOverride,
  modelLoaded: modelLoadedOverride,
  className = "",
}) {
  const { user: authUser, isLoading: authLoading } = useAuth();
  const [now, setNow] = useState(() => new Date());
  const [health, setHealth] = useState(null);

  const user = userOverride ?? authUser;
  const loadingUser = !userOverride && authLoading;

  // Live clock
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const healthRes = await fetch(apiUrl("/health"));
      if (healthRes.ok) {
        setHealth(await healthRes.json());
      }
    } catch {
      setHealth(null);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const poll = setInterval(fetchStatus, 30_000);
    return () => clearInterval(poll);
  }, [fetchStatus]);

  const modelLoaded =
    modelLoadedOverride ?? health?.model_loaded ?? false;
  const healthStatus = health?.status ?? "unknown";

  const systemStatus = useMemo(() => {
    if (statusOverride) return statusOverride;
    if (healthStatus === "ok" && modelLoaded) return "Operational";
    if (healthStatus === "degraded" || !modelLoaded) return "Degraded";
    if (healthStatus === "error") return "Offline";
    return "Syncing…";
  }, [statusOverride, healthStatus, modelLoaded]);

  const statusAccent = useMemo(() => {
    if (systemStatus === "Operational") return "emerald";
    if (systemStatus === "Degraded") return "amber";
    return "cyan";
  }, [systemStatus]);

  const activeChargers =
    activeOverride ??
    (health?.action_dim ? Math.min(health.action_dim, totalChargers) : 5);

  const displayUser = getDisplayUser(user, loadingUser);
  const userRole = user?.role ?? (user?.is_active === false ? "Inactive" : "Grid Operator");
  const userStatus = user?.is_active === false ? "Offline" : healthStatus === "ok" ? "Online" : "Syncing";
  const userSub = `${userRole} · ${userStatus}`;

  return (
    <header
      className={[
        "sticky top-0 z-30 border-b border-cyan-500/10 bg-slate-950/50 backdrop-blur-xl",
        className,
      ].join(" ")}
    >
      {/* Top glow line */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/50 to-transparent"
        aria-hidden
      />

      <div className="relative mx-auto flex max-w-[1600px] flex-col gap-3 px-4 py-3 sm:px-6 lg:px-8 lg:py-4">
        {/* Row 1: title + live clock (desktop) */}
        <div className="flex items-center justify-between gap-4 pl-12 lg:pl-0">
          <div className="min-w-0">
            <p className="font-display text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-500/70">
              Neural Grid
            </p>
            <h2 className="truncate font-display text-lg font-bold text-white sm:text-xl">
              {title}
            </h2>
          </div>

          {/* Clock — visible sm+ in header row; duplicated in grid on xs */}
          <div className="hidden items-center gap-2 rounded-xl border border-cyan-500/15 bg-cyan-500/5 px-3 py-2 sm:flex">
            <ClockIcon className="h-4 w-4 text-cyan-400" />
            <time
              dateTime={now.toISOString()}
              className="font-mono text-xs tabular-nums text-cyan-100/90 sm:text-sm"
            >
              {formatLiveTime(now)}
            </time>
            <span className="hidden h-4 w-px bg-cyan-500/30 md:inline" aria-hidden />
            <span className="hidden text-[10px] uppercase tracking-wider text-emerald-400/80 md:inline">
              Live
            </span>
          </div>
        </div>

        {/* Row 2: stat pills — responsive grid */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <StatPill
            icon={UserIcon}
            label="Current User"
            value={displayUser}
            subValue={userSub}
            accent="cyan"
          />
          <StatPill
            icon={ChargerIcon}
            label="Active Chargers"
            value={`${activeChargers} / ${totalChargers}`}
            subValue="Heterogeneous EVSE fleet"
            accent="cyan"
          />
          <StatPill
            icon={StatusIcon}
            label="System Status"
            value={systemStatus}
            subValue={
              modelLoaded ? "DDPG model loaded" : "Model not loaded"
            }
            accent={statusAccent}
          />
          {/* Mobile-only clock pill */}
          <StatPill
            icon={ClockIcon}
            label="Live Timestamp"
            value={now.toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
            subValue={now.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
            accent="emerald"
            className="xl:hidden"
          />
          {/* Desktop: full timestamp in 4th column */}
          <StatPill
            icon={ClockIcon}
            label="Live Timestamp"
            value={formatLiveTime(now)}
            subValue="UTC-local sync"
            accent="emerald"
            className="hidden xl:flex"
          />
        </div>
      </div>
    </header>
  );
}
