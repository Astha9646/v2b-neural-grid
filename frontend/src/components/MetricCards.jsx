import { memo, useMemo } from "react";
import MetricCard from "./MetricCard";
import { useMetricKpisSlice } from "../hooks/useTelemetrySelectors";
import { PanelSkeleton, StreamBadge, TelemetryError } from "./telemetry/TelemetryStates";

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function EvIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 16h16M6 16l1-5h10l1 5M8 11V8a2 2 0 012-2h4a2 2 0 012 2v3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="7" cy="16" r="1.5" fill="currentColor" />
      <circle cx="17" cy="16" r="1.5" fill="currentColor" />
    </svg>
  );
}

function GridLoadIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 19V5M10 19V9M16 19V12M22 19V7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SolarIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function RewardIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2a4 4 0 014 4v1h1a3 3 0 013 3v2a3 3 0 01-3 3h-1v1a4 4 0 01-8 0v-1H7a3 3 0 01-3-3v-2a3 3 0 013-3h1V6a4 4 0 014-4z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="9" cy="10" r="1" fill="currentColor" />
      <circle cx="15" cy="10" r="1" fill="currentColor" />
    </svg>
  );
}

const ICON_MAP = {
  "active-evs": EvIcon,
  "grid-load": GridLoadIcon,
  "solar-usage": SolarIcon,
  "rl-reward": RewardIcon,
};

const ACCENT_ALIASES = {
  yellow: "amber",
  green: "emerald",
};

const VALID_ACCENTS = new Set(["cyan", "emerald", "amber", "violet", "rose"]);

const STAGGER_MS = [0, 80, 160, 240];

function normalizeTrend(trend) {
  if (!trend) return undefined;
  if (typeof trend === "object" && trend !== null) {
    return {
      direction: trend.direction ?? "neutral",
      value: trend.value ?? "",
      label: trend.label ?? "",
    };
  }
  const value = String(trend);
  let direction = "neutral";
  if (value.startsWith("+")) direction = "up";
  else if (value.startsWith("-")) direction = "down";
  return { direction, value, label: "" };
}

function normalizeAccent(accent) {
  const key = String(accent ?? "cyan").toLowerCase();
  const mapped = ACCENT_ALIASES[key] ?? key;
  return VALID_ACCENTS.has(mapped) ? mapped : "cyan";
}

function normalizeMetricList(raw) {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((item) => item && item.id)
    .map((item) => ({
      id: String(item.id),
      title: item.title ?? "Metric",
      value: item.value ?? 0,
      unit: item.unit ?? "",
      subtitle: item.subtitle ?? "",
      accent: normalizeAccent(item.accent),
      trend: normalizeTrend(item.trend),
    }));
}

function normalizeMetricListFromTelemetry(raw) {
  return normalizeMetricList(raw);
}

function MetricCardsInner({ className = "", hideHeader = false }) {
  const {
    metricKpis,
    loading,
    error,
    isLive,
    isStreaming,
    streamStatus,
    lastUpdated,
    refresh,
  } = useMetricKpisSlice();

  const displayMetrics = useMemo(
    () => normalizeMetricListFromTelemetry(metricKpis),
    [metricKpis],
  );

  if (loading) {
    return <PanelSkeleton className={className} rows={2} />;
  }

  if (error && !metricKpis) {
    return <TelemetryError message={error} onRetry={refresh} className={className} />;
  }

  return (
    <section
      className={["relative", className].join(" ")}
      aria-labelledby={hideHeader ? undefined : "metrics-section-title"}
    >
      {!hideHeader ? (
        <header className="relative mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="section-eyebrow">Live telemetry</p>
            <h2 id="metrics-section-title" className="section-heading">
              Smart-Grid Metrics
            </h2>
            <p className="section-subheading">
              Real-time V2B charging & RL optimization analytics
            </p>
          </div>
          <StreamBadge
            isStreaming={isStreaming}
            streamStatus={streamStatus}
            lastUpdated={lastUpdated}
          />
        </header>
      ) : null}

      {displayMetrics.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">Awaiting telemetry metrics…</p>
      ) : null}

      <div className="relative grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {displayMetrics.map((metric, index) => {
          const Icon = ICON_MAP[metric.id] || GridLoadIcon;

          return (
            <div
              key={metric.id}
              className="animate-fade-in-up opacity-0"
              style={{
                animationDelay: `${STAGGER_MS[index] ?? 0}ms`,
                animationFillMode: "forwards",
              }}
            >
              <MetricCard
                title={metric.title}
                value={metric.value}
                unit={metric.unit}
                subtitle={metric.subtitle}
                icon={Icon}
                trend={metric.trend}
                accent={metric.accent}
                className="h-full min-h-[180px] transition-all duration-500 hover:-translate-y-1 hover:shadow-[0_0_30px_rgba(34,211,238,0.08)]"
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

const MetricCards = memo(MetricCardsInner);
MetricCards.displayName = "MetricCards";

export default MetricCards;
