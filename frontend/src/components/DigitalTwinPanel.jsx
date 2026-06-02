import { memo, useMemo, useState, useCallback, useRef, useEffect, useDeferredValue } from "react";
import { useTwinSlice } from "../hooks/useTelemetrySelectors";
import { StreamBadge, PanelSkeleton, TelemetryError } from "./telemetry/TelemetryStates";
import TwinCanvas from "./digitalTwin/TwinCanvas";
import { buildDigitalTwinScene } from "../utils/digitalTwinMappers";

const DEBUG_RENDER = import.meta.env.DEV;

function ControlToggle({ label, active, onClick, color = "cyan" }) {
  const activeClass =
    color === "violet"
      ? "border-violet-400/50 bg-violet-500/20 text-violet-200"
      : color === "emerald"
        ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-200"
        : color === "rose"
          ? "border-rose-400/50 bg-rose-500/20 text-rose-200"
          : "border-cyan-400/50 bg-cyan-500/20 text-cyan-200";

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-lg border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors",
        active ? activeClass : "border-white/10 bg-slate-900/50 text-slate-500 hover:border-white/20",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function MetricTile({ label, value, unit, accent }) {
  return (
    <div className="rounded-lg border border-white/5 bg-slate-900/50 px-3 py-2">
      <p className="text-[9px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`font-mono text-lg font-bold tabular-nums ${accent ?? "text-cyan-300"}`}>
        {value}
        {unit ? <span className="ml-0.5 text-xs text-slate-500">{unit}</span> : null}
      </p>
    </div>
  );
}

function StressLegend() {
  const items = [
    { color: "bg-rose-500/40", label: "Overload" },
    { color: "bg-amber-500/40", label: "Saturation" },
    { color: "bg-orange-500/40", label: "Thermal" },
    { color: "bg-emerald-500/40", label: "Renewable-rich" },
    { color: "bg-violet-500/40", label: "Anomaly" },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1 text-[9px] text-slate-500">
          <span className={`h-2 w-2 rounded-full ${item.color}`} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function DigitalTwinPanelInner({ className = "" }) {
  const {
    latest,
    fleet,
    inference,
    forecast,
    loading,
    error,
    isStreaming,
    streamStatus,
    lastUpdated,
    refresh,
  } = useTwinSlice();

  const [isPaused, setIsPaused] = useState(false);
  const [liveMode, setLiveMode] = useState(true);
  const [showAI, setShowAI] = useState(true);
  const [showStress, setShowStress] = useState(true);
  const [showRenewable, setShowRenewable] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [isVisible, setIsVisible] = useState(true);
  const viewportRef = useRef(null);

  if (DEBUG_RENDER) {
    console.count("DigitalTwinPanel render");
  }

  const scene = useMemo(
    () =>
      buildDigitalTwinScene({
        latest,
        fleet,
        inference,
        forecast,
      }),
    [
      latest,
      fleet,
      inference,
      forecast?.peakPrediction?.predictedPeakKw,
      inference?.optimization_action,
      inference?.confidence_score,
    ],
  );
  const deferredScene = useDeferredValue(scene);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return undefined;

    const io = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { root: null, threshold: 0.08 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const togglePlay = useCallback(() => setIsPaused((p) => !p), []);
  const effectivePaused = isPaused || (!liveMode && !isStreaming);
  const canvasActive = isVisible && !effectivePaused;

  if (loading && !latest) {
    return <PanelSkeleton className={className} rows={8} />;
  }

  if (error && !latest) {
    return <TelemetryError message={error} onRetry={refresh} className={className} />;
  }

  const m = scene.metrics ?? {};

  return (
    <section
      className={["relative min-w-0", className].join(" ")}
      aria-labelledby="digital-twin-title"
    >
      <div className="relative overflow-hidden rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-slate-950 via-slate-950/95 to-cyan-950/20">
        <header className="relative border-b border-white/5 px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="font-display text-[10px] font-semibold uppercase tracking-[0.32em] text-cyan-400/90">
                Infrastructure simulation
              </p>
              <h2 id="digital-twin-title" className="font-display text-2xl font-bold text-white">
                Digital Twin Operations
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                Lightweight real-time topology — canvas throttled to 24 FPS, pauses when off-screen.
              </p>
            </div>
            <StreamBadge
              isStreaming={isStreaming && liveMode}
              streamStatus={streamStatus}
              lastUpdated={lastUpdated}
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <ControlToggle label={isPaused ? "Play" : "Pause"} active={!isPaused} onClick={togglePlay} />
            <ControlToggle
              label={liveMode ? "Live WS" : "Frozen"}
              active={liveMode}
              onClick={() => setLiveMode((v) => !v)}
              color="emerald"
            />
            <ControlToggle label="AI overlay" active={showAI} onClick={() => setShowAI((v) => !v)} color="violet" />
            <ControlToggle
              label="Stress map"
              active={showStress}
              onClick={() => setShowStress((v) => !v)}
              color="rose"
            />
            <ControlToggle
              label="Renewable routes"
              active={showRenewable}
              onClick={() => setShowRenewable((v) => !v)}
              color="emerald"
            />
            <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-slate-900/60 px-2 py-1">
              <span className="text-[9px] uppercase text-slate-500">Speed</span>
              {[1, 2].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSpeed(s)}
                  className={[
                    "rounded px-2 py-0.5 font-mono text-xs",
                    speed === s ? "bg-cyan-500/25 text-cyan-200" : "text-slate-500",
                  ].join(" ")}
                >
                  {s}×
                </button>
              ))}
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 xl:grid-cols-12">
          <div ref={viewportRef} className="relative xl:col-span-9">
            <div className="relative h-[min(64vh,560px)] min-h-[380px] w-full min-w-0">
              {canvasActive && isStreaming ? (
                <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[9px] font-bold uppercase text-emerald-300">
                  Live · 24fps
                </div>
              ) : !isVisible ? (
                <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-md border border-slate-600/40 bg-slate-900/80 px-2 py-1 text-[9px] text-slate-500">
                  Paused (off-screen)
                </div>
              ) : null}

              <TwinCanvas
                scene={deferredScene}
                isPaused={effectivePaused}
                isVisible={isVisible}
                speedMultiplier={speed}
                showStress={showStress}
                showRenewable={showRenewable}
                showAI={showAI}
              />
            </div>
          </div>

          <aside className="border-t border-white/5 bg-slate-950/60 p-4 xl:col-span-3 xl:border-l xl:border-t-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-300/90">
              Telemetry
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <MetricTile label="Grid load" value={m.loadKw?.toFixed?.(0) ?? "—"} unit="kW" />
              <MetricTile label="Charging" value={m.chargingKw?.toFixed?.(0) ?? "—"} unit="kW" accent="text-violet-300" />
              <MetricTile label="Stress" value={m.stressPct ?? "—"} unit="%" accent="text-rose-300" />
              <MetricTile label="Renewable" value={m.renewablePct ?? "—"} unit="%" accent="text-emerald-300" />
              <MetricTile label="Fleet SOC" value={m.socPct ?? "—"} unit="%" />
              <MetricTile label="Thermal" value={m.thermalC ?? "—"} unit="°C" accent="text-orange-300" />
            </div>

            <div className="mt-4 rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
              <p className="text-[10px] uppercase text-slate-500">DDPG</p>
              <p className="mt-1 font-mono text-xs text-violet-200">{m.policySource}</p>
              <p className="mt-1 text-xs text-slate-400">{m.optimization?.replace?.(/_/g, " ")}</p>
            </div>

            <div className="mt-4">
              <p className="mb-2 text-[10px] font-semibold uppercase text-slate-500">Stress map</p>
              <StressLegend />
              <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto text-[11px] text-slate-400">
                {(scene.zones ?? []).length ? (
                  scene.zones.map((z) => (
                    <li key={z.id} className="flex justify-between rounded border border-white/5 px-2 py-1">
                      <span>{z.label}</span>
                      <span className="font-mono text-rose-300/90">{(z.intensity * 100).toFixed(0)}%</span>
                    </li>
                  ))
                ) : (
                  <li className="text-slate-600">Nominal</li>
                )}
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}

const DigitalTwinPanel = memo(DigitalTwinPanelInner);
DigitalTwinPanel.displayName = "DigitalTwinPanel";

export default DigitalTwinPanel;
