import { memo, useMemo, useState } from "react";
import { useOpsPanelSlice } from "../hooks/useTelemetrySelectors";
import { LiveBadge, PanelSkeleton, TelemetryError } from "./telemetry/TelemetryStates";

const FLEET_STATUS_STYLES = {
  Charging: "bg-cyan-500/15 text-cyan-300 ring-cyan-500/35",
  Idle: "bg-slate-500/15 text-slate-400 ring-slate-500/30",
  "Peak Reduction": "bg-violet-500/15 text-violet-300 ring-violet-500/35",
  "Renewable Optimized": "bg-emerald-500/15 text-emerald-300 ring-emerald-500/35",
  "Thermal Warning": "bg-rose-500/15 text-rose-300 ring-rose-500/40",
  "Battery Protection": "bg-amber-500/15 text-amber-300 ring-amber-500/35",
};

const THERMAL_STYLES = {
  normal: "text-emerald-400",
  elevated: "text-amber-400",
  critical: "text-rose-400",
};

const PRIORITY_ORDER = { critical: 0, high: 1, normal: 2, low: 3 };

const SORT_KEYS = {
  priority: (a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9),
  soc: (a, b) => b.soc - a.soc,
  power: (a, b) => Math.abs(b.power) - Math.abs(a.power),
  health: (a, b) => b.health - a.health,
  stress: (a, b) => b.chargingStress - a.chargingStress,
};

function FleetIcon({ className }) {
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

function SocBar({ value }) {
  const soc = Math.max(0, Math.min(100, Number(value) || 0));
  const barColor =
    soc >= 90
      ? "from-emerald-400 to-cyan-400"
      : soc >= 50
        ? "from-cyan-500 to-cyan-300"
        : soc >= 20
          ? "from-amber-500 to-amber-300"
          : "from-rose-500 to-rose-400";

  return (
    <div className="min-w-[88px]">
      <span className="font-mono text-xs font-semibold tabular-nums text-cyan-100">{soc}%</span>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800/80 ring-1 ring-white/5">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${barColor}`}
          style={{ width: `${soc}%` }}
          role="progressbar"
          aria-valuenow={soc}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
    </div>
  );
}

function StatusChip({ label }) {
  const style = FLEET_STATUS_STYLES[label] ?? FLEET_STATUS_STYLES.Idle;
  return (
    <span
      className={`inline-flex rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider ring-1 ${style}`}
    >
      {label}
    </span>
  );
}

function PowerCell({ power }) {
  const kw = Number(power) || 0;
  const isDischarge = kw < 0;
  const isIdle = Math.abs(kw) < 0.05;
  return (
    <span
      className={`font-mono text-sm font-semibold tabular-nums ${
        isDischarge ? "text-violet-300" : isIdle ? "text-slate-500" : "text-cyan-200"
      }`}
    >
      {isIdle ? "0.0" : `${isDischarge ? "" : "+"}${kw.toFixed(1)}`}
      <span className="ml-0.5 text-xs text-slate-500">kW</span>
    </span>
  );
}

function FleetRow({ row }) {
  return (
    <tr className="border-b border-white/5 transition-colors hover:bg-cyan-500/[0.04]">
      <td className="whitespace-nowrap px-4 py-3 sm:px-5">
        <p className="font-mono text-sm font-bold text-white">{row.evId}</p>
        <p className="text-[10px] text-slate-500">{row.stationId}</p>
      </td>
      <td className="px-4 py-3 sm:px-5 text-xs text-slate-400">{row.charger}</td>
      <td className="px-4 py-3 sm:px-5">
        <SocBar value={row.soc} />
      </td>
      <td className="px-4 py-3 sm:px-5">
        <PowerCell power={row.power} />
      </td>
      <td className="px-4 py-3 sm:px-5 font-mono text-xs text-slate-300">{row.health}%</td>
      <td className="px-4 py-3 sm:px-5 font-mono text-xs text-slate-300">{row.chargingStress}</td>
      <td className={`px-4 py-3 sm:px-5 text-xs capitalize ${THERMAL_STYLES[row.thermalStatus] ?? ""}`}>
        {row.thermalStatus} · {row.thermalC}°C
      </td>
      <td className="px-4 py-3 sm:px-5">
        <StatusChip label={row.fleetStatus} />
      </td>
      <td className="px-4 py-3 sm:px-5 font-mono text-xs text-slate-400">{row.estimatedCompletion}</td>
      <td className="px-4 py-3 sm:px-5 font-mono text-xs text-emerald-300/90">{row.renewableContribution}%</td>
      <td className="px-4 py-3 sm:px-5 font-mono text-xs text-cyan-300/80">{row.gridImpactScore}</td>
    </tr>
  );
}

function FleetCard({ row }) {
  return (
    <article className="rounded-xl border border-white/5 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-sm font-bold text-white">{row.evId}</p>
        <StatusChip label={row.fleetStatus} />
      </div>
      <p className="text-[10px] text-slate-500">
        {row.stationId} · {row.charger}
      </p>
      <div className="mt-3 space-y-2">
        <SocBar value={row.soc} />
        <div className="flex justify-between text-xs">
          <PowerCell power={row.power} />
          <span className="text-slate-500">ETA {row.estimatedCompletion}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-500">
          <span>Health {row.health}%</span>
          <span>Stress {row.chargingStress}</span>
          <span className={THERMAL_STYLES[row.thermalStatus]}>Thermal {row.thermalStatus}</span>
          <span>Grid impact {row.gridImpactScore}</span>
        </div>
      </div>
    </article>
  );
}

function FleetTableInner({ className = "" }) {
  const { fleet, loading, error, isLive, lastUpdated, refresh } = useOpsPanelSlice("fleet");
  const [sortKey, setSortKey] = useState("priority");

  const rows = useMemo(() => {
    const sorted = [...(fleet ?? [])];
    const cmp = SORT_KEYS[sortKey] ?? SORT_KEYS.priority;
    sorted.sort(cmp);
    return sorted;
  }, [fleet, sortKey]);

  const activeCount = useMemo(
    () => rows.filter((r) => r.fleetStatus === "Charging" || r.fleetStatus === "Renewable Optimized").length,
    [rows],
  );

  if (loading && !rows.length) {
    return <PanelSkeleton className={className} rows={6} />;
  }

  if (error && !rows.length) {
    return <TelemetryError message={error} onRetry={refresh} className={className} />;
  }

  return (
    <section className={["relative", className].join(" ")} aria-labelledby="fleet-table-title">
      <div className="relative overflow-hidden rounded-2xl border border-cyan-500/15 bg-white/[0.02] backdrop-blur-md">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/45 to-transparent" />

        <div className="flex flex-col gap-4 border-b border-white/5 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10 ring-1 ring-cyan-400/25">
              <FleetIcon className="h-5 w-5 text-cyan-400" />
            </div>
            <div>
              <p className="section-eyebrow">Fleet ops</p>
              <h2 id="fleet-table-title" className="section-heading">
                EV Fleet Monitor
              </h2>
              <p className="section-subheading">Live fleet derived from grid telemetry</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LiveBadge isLive={isLive} lastUpdated={lastUpdated} />
            <span className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-1.5 text-xs text-emerald-300/90">
              <strong className="tabular-nums">{activeCount}</strong> active
            </span>
            <span className="rounded-lg border border-white/5 bg-slate-900/40 px-3 py-1.5 text-xs text-slate-400">
              {rows.length} vehicles
            </span>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value)}
              className="rounded-lg border border-white/10 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-300"
              aria-label="Sort fleet"
            >
              <option value="priority">Sort: Priority</option>
              <option value="soc">Sort: SOC</option>
              <option value="power">Sort: Power</option>
              <option value="health">Sort: Health</option>
              <option value="stress">Sort: Stress</option>
            </select>
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">No fleet telemetry available</p>
        ) : (
          <>
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full min-w-[1100px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-cyan-500/10 bg-slate-900/40 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="px-5 py-3">EV ID</th>
                    <th className="px-5 py-3">Charger</th>
                    <th className="px-5 py-3">SOC</th>
                    <th className="px-5 py-3">Power</th>
                    <th className="px-5 py-3">Health</th>
                    <th className="px-5 py-3">Stress</th>
                    <th className="px-5 py-3">Thermal</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">ETA</th>
                    <th className="px-5 py-3">Renewable</th>
                    <th className="px-5 py-3">Grid impact</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <FleetRow key={row?.evId ?? `fleet-${i}`} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 p-4 lg:hidden">
              {rows.map((row, i) => (
                <FleetCard key={row?.evId ?? `fleet-card-${i}`} row={row} />
              ))}
            </div>
          </>
        )}

        <footer className="border-t border-white/5 px-4 py-3 text-center text-[10px] text-slate-600">
          V2B Neural Grid · live fleet operations
        </footer>
      </div>
    </section>
  );
}

const FleetTable = memo(FleetTableInner);
FleetTable.displayName = "FleetTable";

export default FleetTable;
