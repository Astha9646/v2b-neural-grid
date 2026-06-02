/**
 * Futuristic KPI card for the Neural Grid AI dashboard.
 *
 * @example
 * <MetricCard
 *   title="Peak Demand"
 *   value={118.3}
 *   unit="kW"
 *   icon={BoltIcon}
 *   trend={{ direction: "down", value: "-12.3%", label: "vs baseline" }}
 *   accent="cyan"
 * />
 */

const ACCENTS = {
  cyan: {
    border: "border-cyan-500/20",
    borderHover: "hover:border-cyan-400/40",
    glow: "hover:shadow-[0_0_20px_rgba(34,211,238,0.1)]",
    iconBg: "bg-cyan-500/10",
    iconRing: "ring-cyan-400/25",
    iconText: "text-cyan-400",
    valueText: "text-cyan-50",
    gradient: "from-cyan-400/10 via-transparent to-transparent",
  },
  emerald: {
    border: "border-emerald-500/20",
    borderHover: "hover:border-emerald-400/40",
    glow: "hover:shadow-[0_0_20px_rgba(52,211,153,0.1)]",
    iconBg: "bg-emerald-500/10",
    iconRing: "ring-emerald-400/25",
    iconText: "text-emerald-400",
    valueText: "text-emerald-50",
    gradient: "from-emerald-400/10 via-transparent to-transparent",
  },
  amber: {
    border: "border-amber-500/20",
    borderHover: "hover:border-amber-400/40",
    glow: "hover:shadow-[0_0_20px_rgba(251,191,36,0.1)]",
    iconBg: "bg-amber-500/10",
    iconRing: "ring-amber-400/25",
    iconText: "text-amber-400",
    valueText: "text-amber-50",
    gradient: "from-amber-400/10 via-transparent to-transparent",
  },
  violet: {
    border: "border-violet-500/20",
    borderHover: "hover:border-violet-400/40",
    glow: "hover:shadow-[0_0_20px_rgba(167,139,250,0.1)]",
    iconBg: "bg-violet-500/10",
    iconRing: "ring-violet-400/25",
    iconText: "text-violet-400",
    valueText: "text-violet-50",
    gradient: "from-violet-400/10 via-transparent to-transparent",
  },
  rose: {
    border: "border-rose-500/20",
    borderHover: "hover:border-rose-400/40",
    glow: "hover:shadow-[0_0_20px_rgba(244,63,94,0.1)]",
    iconBg: "bg-rose-500/10",
    iconRing: "ring-rose-400/25",
    iconText: "text-rose-400",
    valueText: "text-rose-50",
    gradient: "from-rose-400/10 via-transparent to-transparent",
  },
};

const TREND_STYLES = {
  up: {
    bg: "bg-emerald-500/10",
    ring: "ring-emerald-500/25",
    text: "text-emerald-400",
  },
  down: {
    bg: "bg-rose-500/10",
    ring: "ring-rose-500/25",
    text: "text-rose-400",
  },
  neutral: {
    bg: "bg-slate-500/10",
    ring: "ring-slate-500/25",
    text: "text-slate-400",
  },
};

function TrendUpIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 12V4M8 4l-3 3M8 4l3 3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrendDownIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 4v8M8 12l-3-3M8 12l3-3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrendFlatIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M4 8h8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TrendBadge({ trend }) {
  if (!trend) return null;

  const direction = trend.direction ?? "neutral";
  const styles = TREND_STYLES[direction] ?? TREND_STYLES.neutral;
  const TrendIcon =
    direction === "up"
      ? TrendUpIcon
      : direction === "down"
        ? TrendDownIcon
        : TrendFlatIcon;

  return (
    <div
      className={[
        "inline-flex max-w-full items-center gap-1 rounded-lg px-2 py-1 ring-1",
        styles.bg,
        styles.ring,
      ].join(" ")}
      title={trend.label}
    >
      <TrendIcon className={["h-3.5 w-3.5 shrink-0", styles.text].join(" ")} />
      {trend.value ? (
        <span className={["truncate text-xs font-semibold tabular-nums", styles.text].join(" ")}>
          {trend.value}
        </span>
      ) : null}
      {trend.label ? (
        <span className="hidden truncate text-[10px] text-slate-500 sm:inline">
          {trend.label}
        </span>
      ) : null}
    </div>
  );
}

function SkeletonBar({ className = "" }) {
  return (
    <div
      className={["animate-pulse rounded-md bg-slate-700/50", className].join(" ")}
      aria-hidden
    />
  );
}

/**
 * @param {object} props
 * @param {string} props.title - Metric label
 * @param {string | number} props.value - Primary KPI value
 * @param {string} [props.unit] - Unit suffix (kW, %, USD)
 * @param {string} [props.subtitle] - Secondary line under value
 * @param {React.ComponentType<{ className?: string }>} [props.icon] - Icon component
 * @param {React.ReactNode} [props.iconNode] - Custom icon element (overrides icon)
 * @param {{ direction?: 'up'|'down'|'neutral', value?: string, label?: string }} [props.trend]
 * @param {'cyan'|'emerald'|'amber'|'violet'|'rose'} [props.accent]
 * @param {boolean} [props.loading]
 * @param {string} [props.className]
 */
export default function MetricCard({
  title,
  value,
  unit,
  subtitle,
  icon: Icon,
  iconNode,
  trend,
  accent = "cyan",
  loading = false,
  className = "",
}) {
  const theme = ACCENTS[accent] ?? ACCENTS.cyan;

  const displayValue =
    value === null || value === undefined
      ? "—"
      : typeof value === "number"
        ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
        : value;

  return (
    <article
      className={[
        "group relative flex min-h-[8.5rem] flex-col overflow-hidden rounded-2xl border",
        "bg-white/[0.03] p-4 backdrop-blur-md sm:min-h-[9rem] sm:p-5",
        "transition-all duration-300 ease-out",
        "hover:-translate-y-0.5 hover:bg-white/[0.05]",
        theme.border,
        theme.borderHover,
        theme.glow,
        className,
      ].join(" ")}
    >
      {/* Corner gradient wash */}
      <div
        className={[
          "pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-gradient-to-br opacity-60 blur-2xl transition-opacity duration-300 group-hover:opacity-100",
          theme.gradient,
        ].join(" ")}
        aria-hidden
      />

      {/* Animated border shimmer on hover */}
      <div
        className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 ring-1 ring-inset ring-cyan-400/0 transition-all duration-300 group-hover:opacity-100 group-hover:ring-cyan-400/20"
        aria-hidden
      />

      {/* Header: title + icon */}
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {loading ? (
            <SkeletonBar className="mb-2 h-3 w-24" />
          ) : (
            <h3 className="truncate text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              {title}
            </h3>
          )}
        </div>

        {(Icon || iconNode) && (
          <div
            className={[
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 transition-all duration-300",
              "group-hover:scale-105 group-hover:shadow-neon-cyan",
              theme.iconBg,
              theme.iconRing,
            ].join(" ")}
          >
            {iconNode ?? (Icon ? <Icon className={["h-5 w-5", theme.iconText].join(" ")} /> : null)}
          </div>
        )}
      </div>

      {/* Value */}
      <div className="relative mt-3 flex-1">
        {loading ? (
          <>
            <SkeletonBar className="mb-2 h-8 w-28" />
            <SkeletonBar className="h-3 w-20" />
          </>
        ) : (
          <>
            <p
              className={[
                "flex flex-wrap items-baseline gap-x-1.5 font-display text-2xl font-bold tracking-tight sm:text-3xl",
                theme.valueText,
              ].join(" ")}
            >
              <span className="tabular-nums">{displayValue}</span>
              {unit ? (
                <span className="text-base font-medium text-slate-400 sm:text-lg">
                  {unit}
                </span>
              ) : null}
            </p>
            {subtitle ? (
              <p className="mt-1 truncate text-xs text-slate-500">{subtitle}</p>
            ) : null}
          </>
        )}
      </div>

      {/* Trend */}
      <div className="relative mt-3 flex min-h-[1.75rem] items-end">
        {loading ? (
          <SkeletonBar className="h-6 w-20" />
        ) : (
          <TrendBadge trend={trend} />
        )}
      </div>
    </article>
  );
}
