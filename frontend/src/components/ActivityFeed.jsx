import { memo, useMemo, useState } from "react";
import { useActivitiesSlice } from "../hooks/useTelemetrySelectors";
import { LiveBadge, PanelSkeleton, TelemetryError } from "./telemetry/TelemetryStates";

const TYPE_STYLES = {
  optimization: {
    label: "Optimization",
    border: "border-emerald-500/25 hover:border-emerald-400/45",
    glow: "hover:shadow-[0_0_14px_rgba(52,211,153,0.08)]",
    icon: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30",
    badge: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30",
    line: "bg-emerald-400/60",
  },
  reassign: {
    label: "Fleet",
    border: "border-cyan-500/25 hover:border-cyan-400/45",
    glow: "hover:shadow-[0_0_28px_rgba(34,211,238,0.16)]",
    icon: "bg-cyan-500/15 text-cyan-400 ring-cyan-500/35 ",
    badge: "bg-cyan-500/10 text-cyan-300 ring-cyan-500/30",
    line: "bg-cyan-400/60",
  },
  forecast: {
    label: "Forecast",
    border: "border-amber-500/25 hover:border-amber-400/45",
    glow: "hover:shadow-[0_0_28px_rgba(251,191,36,0.14)]",
    icon: "bg-amber-500/15 text-amber-400 ring-amber-500/35 ",
    badge: "bg-amber-500/10 text-amber-300 ring-amber-500/30",
    line: "bg-amber-400/60",
  },
  delay: {
    label: "Delay",
    border: "border-rose-500/25 hover:border-rose-400/45",
    glow: "hover:shadow-[0_0_28px_rgba(244,63,94,0.14)]",
    icon: "bg-rose-500/15 text-rose-400 ring-rose-500/35 ",
    badge: "bg-rose-500/10 text-rose-300 ring-rose-500/30",
    line: "bg-rose-400/60",
  },
  v2b: {
    label: "V2B",
    border: "border-violet-500/25 hover:border-violet-400/45",
    glow: "hover:shadow-[0_0_28px_rgba(167,139,250,0.14)]",
    icon: "bg-violet-500/15 text-violet-400 ring-violet-500/35 ",
    badge: "bg-violet-500/10 text-violet-300 ring-violet-500/30",
    line: "bg-violet-400/60",
  },
  mask: {
    label: "Mask",
    border: "border-cyan-500/20 hover:border-cyan-400/40",
    glow: "hover:shadow-[0_0_24px_rgba(34,211,238,0.12)]",
    icon: "bg-cyan-500/10 text-cyan-400 ring-cyan-500/30 ",
    badge: "bg-cyan-500/10 text-cyan-300 ring-cyan-500/25",
    line: "bg-cyan-400/40",
  },
  session: {
    label: "Session",
    border: "border-teal-500/20 hover:border-teal-400/40",
    glow: "hover:shadow-[0_0_24px_rgba(45,212,191,0.12)]",
    icon: "bg-teal-500/10 text-teal-400 ring-teal-500/30 ",
    badge: "bg-teal-500/10 text-teal-300 ring-teal-500/25",
    line: "bg-teal-400/50",
  },
};

const STAGGER_MS = [0, 60, 120, 180, 240, 300, 360];

function formatTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function formatRelative(iso) {
  try {
    const d = new Date(iso);
    const mins = Math.floor((Date.now() - d) / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    return formatTime(iso);
  } catch {
    return "";
  }
}

function ActivityIcon({ type, className }) {
  const icons = {
    optimization: (
      <path
        d="M12 2a4 4 0 014 4v1h1a3 3 0 013 3v2a3 3 0 01-3 3h-1v1a4 4 0 01-8 0v-1H7a3 3 0 01-3-3v-2a3 3 0 013-3h1V6a4 4 0 014-4z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    ),
    reassign: (
      <>
        <path d="M7 16h10M7 16l3-3M7 16l3 3M17 8H7M17 8l-3-3M17 8l-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
    forecast: (
      <>
        <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </>
    ),
    delay: (
      <>
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
        <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </>
    ),
    v2b: (
      <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    ),
    mask: (
      <path d="M4 19V5M10 19V9M16 19V12M22 19V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    ),
    session: (
      <>
        <rect x="4" y="7" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M18 10h2v4h-2" stroke="currentColor" strokeWidth="1.5" />
      </>
    ),
  };

  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      {icons[type] ?? icons.optimization}
    </svg>
  );
}

function TimelineIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3v18M8 7h8M8 12h6M8 17h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ActivityItem({ activity, index, isLast }) {
  const style = TYPE_STYLES[activity.type] ?? TYPE_STYLES.optimization;

  return (
    <li className="relative flex gap-3 pb-3 last:pb-0">
      {/* Timeline spine */}
      {!isLast ? (
        <div
          className={[
            "absolute left-[17px] top-9 bottom-0 w-px bg-gradient-to-b to-transparent",
            style.line,
          ].join(" ")}
          aria-hidden
        />
      ) : null}

      {/* Icon node */}
      <div
        className={[
          "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1",
          style.icon,
        ].join(" ")}
      >
        <ActivityIcon type={activity.type} className="h-4 w-4" />
      </div>

      {/* Card */}
      <article
        className={[
          "group min-w-0 flex-1 rounded-lg border bg-white/[0.02] p-2.5 backdrop-blur-sm",
          "transition-colors duration-200 hover:bg-white/[0.04]",
          style.border,
          style.glow,
        ].join(" ")}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={[
              "rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1",
              style.badge,
            ].join(" ")}
          >
            {style.label}
          </span>
          <time
            dateTime={activity.timestamp}
            className="font-mono text-[10px] tabular-nums text-slate-500"
            title={activity.timestamp}
          >
            {formatTime(activity.timestamp)}
          </time>
          <span className="ml-auto text-[10px] text-slate-600">{formatRelative(activity.timestamp)}</span>
        </div>
        <h4 className="mt-1 text-sm font-semibold text-slate-100">{activity.title}</h4>
        <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-slate-500">{activity.detail}</p>
        <p className="mt-1 text-[10px] text-slate-600">{activity.actor}</p>
      </article>
    </li>
  );
}

/**
 * AI activity timeline feed for V2B operations (demo data).
 *
 * @param {object} [props]
 * @param {typeof DEMO_ACTIVITIES} [props.activities]
 * @param {string} [props.className]
 */
function ActivityFeedInner({ className = "", compact = false }) {
  const {
    activities: feed,
    streamEvents,
    loading,
    error,
    isLive,
    isStreaming,
    lastUpdated,
    refresh,
  } = useActivitiesSlice();
  const [filter, setFilter] = useState("all");

  const activities = useMemo(() => {
    const wsEvents = (streamEvents ?? []).map((e, i) => ({
      id: `ws-${e.type}-${i}`,
      type: e.type === "ddpg_decision" ? "optimization" : e.type === "renewable_shift" ? "forecast" : "delay",
      title: e.title,
      detail: e.detail,
      timestamp: e.timestamp ?? new Date().toISOString(),
      actor: "WebSocket Stream",
    }));
    const sorted = [...(feed ?? []), ...wsEvents]
      .filter((a) => a && a.timestamp)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    if (filter === "all") return sorted;
    return sorted.filter((a) => a?.type === filter);
  }, [feed, streamEvents, filter]);

  const filterOptions = [
    { key: "all", label: "All" },
    { key: "optimization", label: "Optimization" },
    { key: "reassign", label: "Fleet" },
    { key: "forecast", label: "Forecast" },
    { key: "delay", label: "Delay" },
  ];

  if (loading && !activities.length) {
    return <PanelSkeleton className={className} rows={5} />;
  }

  if (error && !activities.length) {
    return <TelemetryError message={error} onRetry={refresh} className={className} />;
  }

  return (
    <section className={["relative", className].join(" ")} aria-labelledby="activity-feed-title">
      <div className="panel-shell panel-shell-accent h-full">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/25 to-violet-400/20"
          aria-hidden
        />

        <header className="relative mb-4 flex items-start justify-between gap-2.5">
          <div className="flex items-start gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 ring-1 ring-cyan-400/20">
              <TimelineIcon className="h-4 w-4 text-cyan-400" />
            </div>
            <div>
              <p className="section-eyebrow text-violet-400/70">Activity</p>
              <h2 id="activity-feed-title" className="text-base font-semibold text-white">
                AI Operations Timeline
              </h2>
            </div>
          </div>
          <LiveBadge isLive={isLive} isStreaming={isStreaming} lastUpdated={lastUpdated} />
        </header>

        <div className="relative mb-3 flex flex-wrap gap-1.5">
          {filterOptions.map(({ key, label }) => (
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

        <ol className={["relative", compact ? "scroll-panel" : "scroll-panel max-h-[min(20rem,45vh)]"].join(" ")}>
          {activities.map((activity, index) => (
            <div
              key={activity.id}
              className="animate-fade-in-up opacity-0"
              style={{
                animationDelay: `${STAGGER_MS[index % STAGGER_MS.length]}ms`,
                animationFillMode: "forwards",
              }}
            >
              <ActivityItem
                activity={activity}
                index={index}
                isLast={index === activities.length - 1}
              />
            </div>
          ))}
        </ol>

        <footer className="relative mt-3 border-t border-white/5 pt-3 text-[10px] text-slate-600">
          {activities.length} operational events · live AI timeline
        </footer>
      </div>
    </section>
  );
}

const ActivityFeed = memo(ActivityFeedInner);
ActivityFeed.displayName = "ActivityFeed";

export default ActivityFeed;
