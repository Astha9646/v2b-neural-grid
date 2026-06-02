import { memo, useEffect, useMemo, useState } from "react";
import { useOpsPanelSlice } from "../hooks/useTelemetrySelectors";
import { LiveBadge, PanelSkeleton, TelemetryError } from "./telemetry/TelemetryStates";

const SEVERITY_STYLES = {
  critical: {
    badge: "bg-rose-500/15 text-rose-300 ring-rose-500/40",
    border: "border-rose-500/30",
    glow: "hover:shadow-[0_0_16px_rgba(244,63,94,0.1)]",
    iconBg: "bg-rose-500/15 ring-rose-500/35 text-rose-400",
    accent: "from-rose-500/10 via-transparent to-transparent",
  },
  high: {
    badge: "bg-amber-500/15 text-amber-300 ring-amber-500/40",
    border: "border-amber-500/30",
    glow: "hover:shadow-[0_0_32px_rgba(251,191,36,0.16)]",
    iconBg: "bg-amber-500/15 ring-amber-500/35 text-amber-400",
    accent: "from-amber-500/10 via-transparent to-transparent",
  },
  medium: {
    badge: "bg-cyan-500/15 text-cyan-300 ring-cyan-500/35",
    border: "border-cyan-500/25",
    glow: "hover:shadow-[0_0_28px_rgba(34,211,238,0.14)]",
    iconBg: "bg-cyan-500/15 ring-cyan-500/30 text-cyan-400",
    accent: "from-cyan-500/10 via-transparent to-transparent",
  },
  low: {
    badge: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/35",
    border: "border-emerald-500/20",
    glow: "hover:shadow-[0_0_24px_rgba(52,211,153,0.12)]",
    iconBg: "bg-emerald-500/15 ring-emerald-500/30 text-emerald-400",
    accent: "from-emerald-500/10 via-transparent to-transparent",
  },
};

const STAGGER_MS = [0, 50, 100, 150, 200, 250];

function formatTime(iso) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now - d;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function BellIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3a5 5 0 00-5 5v2.5c0 .5-.2 1-.6 1.4L5 13h14l-1.4-1.6c-.4-.4-.6-.9-.6-1.4V8a5 5 0 00-5-5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M10 17a2 2 0 004 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function PeakIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 19V5M10 19V9M16 19V12M22 19V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function DelayIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SolarIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ThermalIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M14 4v8.5a4 4 0 11-4 0V4a2 2 0 014 0z" stroke="currentColor" strokeWidth="1.5" />
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

function InfoIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 11v5M12 8h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

const ICON_MAP = {
  peak: PeakIcon,
  delay: DelayIcon,
  solar: SolarIcon,
  thermal: ThermalIcon,
  v2b: BoltIcon,
  info: InfoIcon,
};

function SeverityBadge({ severity }) {
  const s = SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.medium;
  return (
    <span
      className={[
        "inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1",
        s.badge,
      ].join(" ")}
    >
      {severity}
    </span>
  );
}

function NotificationCard({ item, index, onDismiss }) {
  const s = SEVERITY_STYLES[item.severity] ?? SEVERITY_STYLES.medium;
  const Icon = ICON_MAP[item.icon] ?? InfoIcon;

  return (
    <article
      className={[
        "group relative overflow-hidden rounded-lg border bg-white/[0.02] p-3 backdrop-blur-sm",
        "transition-colors duration-200 hover:bg-white/[0.04]",
        s.border,
        s.glow,
        item.unread ? "ring-1 ring-inset ring-cyan-400/8" : "opacity-85",
      ].join(" ")}
      style={{
        animationDelay: `${STAGGER_MS[index % STAGGER_MS.length]}ms`,
      }}
    >
      <div
        className={[
          "pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br opacity-60 blur-2xl transition-opacity group-hover:opacity-100",
          s.accent,
        ].join(" ")}
        aria-hidden
      />

      {item.unread ? (
        <span
          className="absolute left-0 top-0 h-full w-0.5 bg-gradient-to-b from-cyan-400/80 to-emerald-400/60"
          aria-hidden
        />
      ) : null}

      <div className="relative flex gap-3 sm:gap-4">
        <div
          className={[
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 transition-transform duration-300 group-hover:scale-110",
            s.iconBg,
          ].join(" ")}
        >
          <Icon className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={item.severity} />
            {item.unread ? (
              <span className="rounded-full bg-cyan-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-cyan-300">
                New
              </span>
            ) : null}
            <time
              dateTime={item.timestamp}
              className="ml-auto font-mono text-[10px] tabular-nums text-slate-500"
            >
              {formatTime(item.timestamp)}
            </time>
          </div>

          <h4 className="mt-1.5 text-sm font-semibold text-slate-100">
            {item.title}
          </h4>
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500">
            {item.message}
          </p>
          <p className="mt-2 text-[10px] uppercase tracking-wider text-slate-600">
            {item.source}
          </p>
        </div>

        <button
          type="button"
          onClick={() => onDismiss(item.id)}
          className="shrink-0 self-start rounded-lg border border-transparent p-1.5 text-slate-600 transition-all hover:border-white/10 hover:bg-slate-800/60 hover:text-slate-300"
          aria-label={`Dismiss ${item.title}`}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </article>
  );
}

/**
 * Real-time notification feed for V2B smart-grid operations (demo data).
 *
 * @param {object} [props]
 * @param {typeof DEMO_NOTIFICATIONS} [props.notifications]
 * @param {string} [props.className]
 */
function NotificationPanelInner({ className = "", compact = false }) {
  const { alerts, loading, error, isLive, lastUpdated, refresh } = useOpsPanelSlice("alerts");
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    setItems(Array.isArray(alerts) ? alerts : []);
  }, [alerts]);

  const safeItems = items ?? [];

  const filtered = useMemo(() => {
    if (filter === "all") return safeItems;
    if (filter === "unread") return safeItems.filter((n) => n?.unread);
    return safeItems.filter((n) => n?.severity === filter);
  }, [safeItems, filter]);

  const unreadCount = safeItems.filter((n) => n?.unread).length;
  const criticalCount = safeItems.filter((n) => n?.severity === "critical").length;

  const dismiss = (id) => setItems((prev) => prev.filter((n) => n.id !== id));
  const markAllRead = () =>
    setItems((prev) => prev.map((n) => ({ ...n, unread: false })));

  if (loading && !items.length) {
    return <PanelSkeleton className={className} rows={4} />;
  }

  if (error && !items.length) {
    return <TelemetryError message={error} onRetry={refresh} className={className} />;
  }

  return (
    <section
      className={["relative", className].join(" ")}
      aria-labelledby="notification-panel-title"
    >
      <div className={["panel-shell panel-shell-accent h-full", compact ? "p-4" : ""].join(" ")}>
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-rose-400/20 to-cyan-400/25"
          aria-hidden
        />

        <header className="relative mb-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 ring-1 ring-cyan-400/20">
              <BellIcon className="h-4 w-4 text-cyan-400" />
              {unreadCount > 0 ? (
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white">
                  {unreadCount}
                </span>
              ) : null}
            </div>
            <div className="min-w-0">
              <p className="section-eyebrow">Alerts</p>
              <h2 id="notification-panel-title" className="text-base font-semibold text-white">
                Notifications
              </h2>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <LiveBadge isLive={isLive} lastUpdated={lastUpdated} />
            <button
              type="button"
              onClick={markAllRead}
              className="rounded-md border border-white/10 px-2.5 py-1 text-[11px] font-medium text-slate-500 transition-colors hover:border-cyan-500/20 hover:text-cyan-200"
            >
              Mark read
            </button>
          </div>
        </header>

        {criticalCount > 0 ? (
          <p className="mb-3 text-xs text-rose-300/90">{criticalCount} critical alert(s)</p>
        ) : null}

        <div className="relative mb-3 flex flex-wrap gap-1.5">
          {[
            { key: "all", label: "All" },
            { key: "unread", label: "Unread" },
            { key: "critical", label: "Critical" },
            { key: "high", label: "High" },
          ].map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={[
                "rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors duration-200",
                filter === key
                  ? "border-cyan-400/30 bg-cyan-500/10 text-cyan-200"
                  : "border-white/10 text-slate-500 hover:border-cyan-500/15 hover:text-cyan-200",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Notification list */}
        <div className={["relative space-y-2", compact ? "scroll-panel" : "scroll-panel max-h-[min(20rem,45vh)]"].join(" ")}>
          {filtered.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-500">No notifications</p>
          ) : (
            filtered.map((item, index) => (
              <div
                key={item.id}
                className="animate-fade-in-up opacity-0"
                style={{
                  animationDelay: `${STAGGER_MS[index % STAGGER_MS.length]}ms`,
                  animationFillMode: "forwards",
                }}
              >
                <NotificationCard item={item} index={index} onDismiss={dismiss} />
              </div>
            ))
          )}
        </div>

        <footer className="relative mt-3 border-t border-white/5 pt-3 text-[10px] text-slate-600">
          {safeItems.length} AI-generated alerts · live telemetry
        </footer>
      </div>
    </section>
  );
}

const NotificationPanel = memo(NotificationPanelInner);
NotificationPanel.displayName = "NotificationPanel";

export default NotificationPanel;
