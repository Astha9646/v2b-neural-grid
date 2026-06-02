import { memo, useMemo } from "react";
import { useChartsPanelSlice } from "../hooks/useTelemetrySelectors";
import { LiveBadge, PanelSkeleton, TelemetryError } from "./telemetry/TelemetryStates";

// ---------------------------------------------------------------------------
// Demo energy flow telemetry (digital twin)
// ---------------------------------------------------------------------------

const NODE_POSITIONS = {
  solar: { x: 14, y: 16 },
  grid: { x: 86, y: 16 },
  building: { x: 50, y: 34 },
  battery: { x: 50, y: 56 },
  chargers: { x: 20, y: 82 },
  evs: { x: 80, y: 82 },
};

const NODE_STYLES = {
  amber: {
    ring: "ring-amber-400/40",
    bg: "bg-amber-500/15",
    glow: "shadow-[0_0_12px_rgba(251,191,36,0.2)]",
    text: "text-amber-300",
  },
  cyan: {
    ring: "ring-cyan-400/40",
    bg: "bg-cyan-500/15",
    glow: "shadow-[0_0_12px_rgba(34,211,238,0.2)]",
    text: "text-cyan-300",
  },
  slate: {
    ring: "ring-slate-400/30",
    bg: "bg-slate-500/15",
    glow: "shadow-[0_0_20px_rgba(148,163,184,0.2)]",
    text: "text-slate-200",
  },
  violet: {
    ring: "ring-violet-400/40",
    bg: "bg-violet-500/15",
    glow: "shadow-[0_0_12px_rgba(167,139,250,0.2)]",
    text: "text-violet-300",
  },
  emerald: {
    ring: "ring-emerald-400/40",
    bg: "bg-emerald-500/15",
    glow: "shadow-[0_0_12px_rgba(52,211,153,0.2)]",
    text: "text-emerald-300",
  },
};

/** SVG path definitions for animated flows (viewBox 0 0 100 100) */
const FLOW_PATHS = {
  "solar-building": "M 14 16 Q 32 20, 50 34",
  "grid-chargers": "M 86 16 Q 70 48, 20 82",
  "battery-evs": "M 50 56 Q 65 68, 80 82",
};

function SunNodeIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function GridNodeIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 19V5M10 19V9M16 19V12M22 19V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function BuildingNodeIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 20V8l8-4 8 4v12H4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M9 20v-4h6v4" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function BatteryNodeIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="7" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M18 10h2v4h-2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function ChargerNodeIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function EvNodeIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 16h16M6 16l1-5h10l1 5M8 11V8a2 2 0 012-2h4a2 2 0 012 2v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7" cy="16" r="1.5" fill="currentColor" />
      <circle cx="17" cy="16" r="1.5" fill="currentColor" />
    </svg>
  );
}

const NODE_ICONS = {
  solar: SunNodeIcon,
  grid: GridNodeIcon,
  building: BuildingNodeIcon,
  battery: BatteryNodeIcon,
  chargers: ChargerNodeIcon,
  evs: EvNodeIcon,
};

function FlowDiagram({ flows, nodes }) {
  return (
    <div className="relative h-[300px] w-full min-w-0 overflow-hidden">
      <style>{`
        @keyframes energyFlowDash {
          to { stroke-dashoffset: -32; }
        }
        .energy-flow-line {
          animation: energyFlowDash 1.8s linear infinite;
        }
        @keyframes nodePulse {
          0%, 100% { opacity: 0.6; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.05); }
        }
        .energy-node-pulse {
          animation: nodePulse 3s ease-in-out infinite;
        }
      `}</style>

      {/* SVG layer — flows */}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
      >
        <defs>
          <linearGradient id="flowGradSolar" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.2" />
            <stop offset="50%" stopColor="#fbbf24" stopOpacity="1" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.8" />
          </linearGradient>
          <linearGradient id="flowGradCyan" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="1" />
          </linearGradient>
          <linearGradient id="flowGradViolet" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#34d399" stopOpacity="1" />
          </linearGradient>
          <filter id="flowGlow">
            <feGaussianBlur stdDeviation="1.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Subtle hub ring at building */}
        <circle
          cx="50"
          cy="45"
          r="18"
          fill="none"
          stroke="rgba(34,211,238,0.08)"
          strokeWidth="0.5"
          strokeDasharray="2 4"
        />

        {flows.map((flow, i) => {
          const pathD = FLOW_PATHS[flow.id];
          const gradId =
            flow.id === "solar-building"
              ? "url(#flowGradSolar)"
              : flow.id === "grid-chargers"
                ? "url(#flowGradCyan)"
                : "url(#flowGradViolet)";

          return (
            <g key={flow.id}>
              {/* Glow underlay */}
              <path
                d={pathD}
                fill="none"
                stroke={flow.color}
                strokeWidth="3"
                strokeOpacity="0.15"
                filter="url(#flowGlow)"
              />
              {/* Animated dash */}
              <path
                d={pathD}
                fill="none"
                stroke={gradId}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeDasharray="6 5"
                strokeDashoffset="0"
                className="energy-flow-line"
                style={{ animationDelay: `${i * 0.4}s` }}
              />
              {/* Direction arrow marker at midpoint — simplified dot */}
            </g>
          );
        })}
      </svg>

      {/* HTML nodes */}
      {Object.entries(nodes).map(([key, node]) => {
        const pos = NODE_POSITIONS[key];
        if (!pos) return null;
        const style = NODE_STYLES[node.color] ?? NODE_STYLES.cyan;
        const Icon = NODE_ICONS[key] ?? BuildingNodeIcon;

        return (
          <div
            key={key}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
          >
            <div
              className={[
                "energy-node-pulse flex flex-col items-center rounded-xl border border-white/10 px-3 py-2 backdrop-blur-md transition-all duration-300",
                "hover:scale-105 hover:border-cyan-400/30",
                style.bg,
                style.ring,
                style.glow,
              ].join(" ")}
              style={{ animationDelay: `${Object.keys(nodes).indexOf(key) * 0.5}s` }}
            >
              <div className={["mb-1 flex h-9 w-9 items-center justify-center rounded-lg ring-1 ring-inset ring-white/10", style.text].join(" ")}>
                <Icon className="h-5 w-5" />
              </div>
              <p className="whitespace-nowrap text-center text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {node.label}
              </p>
              <p className={["font-mono text-sm font-bold tabular-nums", style.text].join(" ")}>
                {node.kw.toFixed(1)}
                <span className="text-[10px] font-medium text-slate-500"> kW</span>
              </p>
              {node.soc != null ? (
                <p className="text-[9px] text-slate-500">SOC {node.soc}%</p>
              ) : (
                <p className="text-[9px] text-slate-600">{node.sublabel}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FlowMetricCard({ flow }) {
  return (
    <div
      className={[
        "group rounded-xl border border-white/10 bg-white/[0.03] p-3 backdrop-blur-sm",
        "transition-all duration-300 hover:-translate-y-0.5 hover:border-cyan-500/25",
        "hover:shadow-[0_0_24px_rgba(34,211,238,0.1)]",
      ].join(" ")}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: flow.color, boxShadow: `0 0 8px ${flow.color}` }}
        />
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {flow.label}
        </p>
      </div>
      <p className="mt-2 font-display text-xl font-bold tabular-nums text-white">
        {flow.kw.toFixed(1)}
        <span className="ml-1 text-sm font-medium text-slate-500">kW</span>
      </p>
    </div>
  );
}

/**
 * Smart-grid energy flow digital twin panel (demo data).
 *
 * @param {object} [props]
 * @param {typeof DEMO_FLOW} [props.data]
 * @param {string} [props.className]
 */
function EnergyFlowPanelInner({ data: dataProp, className = "" }) {
  const { energyFlow, loading, error, isLive, lastUpdated, refresh } = useChartsPanelSlice("energyFlow");
  const data = useMemo(() => dataProp ?? energyFlow, [dataProp, energyFlow]);

  if (loading && !dataProp) {
    return <PanelSkeleton className={className} rows={6} />;
  }

  if (error && !dataProp && !energyFlow) {
    return <TelemetryError message={error} onRetry={refresh} className={className} />;
  }

  if (!data) {
    return <PanelSkeleton className={className} rows={6} />;
  }

  return (
    <EnergyFlowPanelView
      data={data}
      className={className}
      isLive={isLive}
      lastUpdated={lastUpdated}
    />
  );
}

function EnergyFlowPanelView({ data, className, isLive, lastUpdated }) {
  const nodes = data?.nodes ?? {};
  const flows = data?.flows ?? [];
  const netBalance = data?.netBalance ?? {
    renewablePct: 0,
    gridImportKw: 0,
    v2bExportKw: 0,
  };

  const totalFlowKw = useMemo(
    () => flows.reduce((sum, f) => sum + (Number(f?.kw) || 0), 0),
    [flows],
  );

  return (
    <section className={["relative min-w-0", className].join(" ")} aria-labelledby="energy-flow-title">
      <div
        className={[
          "relative min-w-0 overflow-hidden rounded-2xl border border-cyan-500/15",
          "bg-white/[0.02] p-4 backdrop-blur-md sm:p-6",
          "transition-shadow duration-300 hover:shadow-[0_0_24px_rgba(34,211,238,0.06)]",
        ].join(" ")}
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-amber-400/40 via-cyan-400/50 to-emerald-400/40"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-500/5 blur-[100px]"
          aria-hidden
        />

        <header className="relative mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500/15 via-cyan-500/15 to-emerald-500/10 ring-1 ring-cyan-400/25">
              <svg className="h-6 w-6 text-cyan-400" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M4 12h16M12 4v16M7 7l10 10M17 7L7 17"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div>
              <p className="font-display text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-500/80">
                Digital twin
              </p>
              <h2 id="energy-flow-title" className="font-display text-xl font-bold text-white sm:text-2xl">
                Energy Flow Map
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                Live power paths from grid_telemetry.csv
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <LiveBadge isLive={isLive} lastUpdated={lastUpdated} />
            <span className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-1.5 text-emerald-300">
              {netBalance.renewablePct}% renewable
            </span>
            <span className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-3 py-1.5 text-cyan-300/90">
              Grid +{netBalance.gridImportKw} kW
            </span>
            <span className="rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-1.5 text-violet-300/90">
              V2B −{netBalance.v2bExportKw} kW
            </span>
          </div>
        </header>

        {/* Diagram */}
        <div
          className="relative min-w-0 overflow-hidden rounded-xl border border-white/5 bg-slate-950/40 p-2 sm:p-4 animate-fade-in-up"
          style={{ animationFillMode: "both" }}
        >
          <FlowDiagram flows={flows} nodes={nodes} />
        </div>

        {/* Flow metrics */}
        <div className="relative mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {flows.map((flow) => (
            <FlowMetricCard key={flow.id} flow={flow} />
          ))}
        </div>

        <div className="relative mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/5 bg-slate-900/30 px-4 py-3 text-xs text-slate-500">
          <span>
            Aggregate routed power:{" "}
            <strong className="font-mono text-cyan-300">{totalFlowKw.toFixed(1)} kW</strong>
          </span>
          <span className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-40" />
              <span className="relative h-2 w-2 rounded-full bg-cyan-400" />
            </span>
            Live telemetry stream
          </span>
        </div>

        <footer className="relative mt-4 border-t border-white/5 pt-4 text-center text-[10px] text-slate-600">
          Solar → Building · Grid → Chargers · Battery → EVs · DDPG-optimized dispatch
        </footer>
      </div>
    </section>
  );
}

const EnergyFlowPanel = memo(EnergyFlowPanelInner);
EnergyFlowPanel.displayName = "EnergyFlowPanel";

export default EnergyFlowPanel;
