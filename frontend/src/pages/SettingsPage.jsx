import InfrastructureMetrics from "../components/InfrastructureMetrics";
import PerformancePanel from "../components/PerformancePanel";
import SystemHealthPanel from "../components/SystemHealthPanel";
import { useTelemetryStream, useTelemetryCharts } from "../hooks/useTelemetrySelectors";
import { useObservability } from "../context/ObservabilityContext";

export default function SettingsPage() {
  const { isStreaming, streamStatus, lastUpdated } = useTelemetryStream();
  const { rows } = useTelemetryCharts();
  const { health, metrics, refresh } = useObservability();

  return (
    <div className="min-w-0 space-y-8">
      <header className="min-w-0">
        <p className="section-eyebrow">Settings</p>
        <h1 className="font-display text-2xl font-bold text-white">System Settings</h1>
        <p className="section-subheading">Platform health, streams, and operator preferences</p>
      </header>

      <InfrastructureMetrics />

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
        <PerformancePanel />
        <SystemHealthPanel />
      </div>

      <div className="panel-shell min-w-0">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="section-heading">Stream status</h2>
          <button
            type="button"
            onClick={refresh}
            className="text-[10px] font-semibold uppercase tracking-wider text-cyan-400 hover:text-cyan-300"
          >
            Refresh metrics
          </button>
        </div>
        <ul className="space-y-2 text-sm text-slate-400">
          <li className="break-words">
            Platform:{" "}
            <span className="font-mono text-emerald-300">{health?.status ?? "—"}</span>
          </li>
          <li className="break-words">
            WebSocket:{" "}
            <span className="font-mono text-cyan-300">{isStreaming ? "connected" : "offline"}</span>
            {" · "}
            <span className="font-mono text-slate-300">{health?.websocket_clients ?? 0} server clients</span>
          </li>
          <li className="break-words">
            Telemetry buffer: <span className="font-mono text-cyan-300">{rows?.length ?? 0} rows</span>
          </li>
          <li className="break-words">
            Stream rate:{" "}
            <span className="font-mono text-violet-300">
              {(health?.stream_rate ?? metrics?.stream_rate ?? 0).toFixed(2)} msg/s
            </span>
          </li>
          <li className="break-words">
            Last update:{" "}
            <span className="font-mono text-cyan-300">
              {lastUpdated ? lastUpdated.toLocaleString() : "—"}
            </span>
          </li>
          {Object.entries(streamStatus ?? {}).map(([ch, st]) => (
            <li key={ch} className="break-words">
              {ch}: <span className="font-mono text-slate-300">{st}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
