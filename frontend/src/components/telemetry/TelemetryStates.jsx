/**
 * Shared loading / error UI for telemetry-driven panels.
 */

export function ChartSkeleton({ className = "", label = "Loading telemetry…" }) {
  return (
    <div
      className={[
        "flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-cyan-500/10 bg-slate-900/40",
        className,
      ].join(" ")}
    >
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
      <p className="mt-3 text-sm text-cyan-300/90">{label}</p>
    </div>
  );
}

export function PanelSkeleton({ className = "", rows = 3 }) {
  return (
    <div
      className={[
        "animate-pulse space-y-4 rounded-2xl border border-white/10 bg-white/[0.02] p-6",
        className,
      ].join(" ")}
    >
      <div className="h-4 w-1/3 rounded bg-slate-700/60" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-16 rounded-xl bg-slate-800/40" />
      ))}
    </div>
  );
}

export function ChartEmptyState({ className = "", message = "Waiting for telemetry stream…" }) {
  return (
    <div
      className={[
        "flex min-h-[280px] flex-col items-center justify-center rounded-xl border border-dashed border-cyan-500/20 bg-slate-900/30 px-4 text-center",
        className,
      ].join(" ")}
    >
      <p className="text-sm font-medium text-slate-400">{message}</p>
      <p className="mt-1 text-xs text-slate-600">WebSocket or HTTP snapshot will populate this chart</p>
    </div>
  );
}

export function TelemetryError({ message, onRetry, className = "" }) {
  return (
    <div
      className={[
        "rounded-2xl border border-amber-500/25 bg-amber-500/5 p-6 text-center",
        className,
      ].join(" ")}
    >
      <p className="text-sm font-medium text-amber-200">Telemetry unavailable</p>
      <p className="mt-2 text-xs text-slate-400">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-xs font-semibold text-cyan-200 transition-colors hover:bg-cyan-500/20"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function LiveBadge({ isLive, lastUpdated, isStreaming, label }) {
  const timeStr = lastUpdated
    ? lastUpdated.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "—";

  const streaming = Boolean(isStreaming ?? isLive);

  return (
    <div
      className={[
        "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider",
        streaming
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
          : isLive
            ? "border-cyan-500/25 bg-cyan-500/10 text-cyan-300"
            : "border-slate-600/40 bg-slate-900/40 text-slate-500",
      ].join(" ")}
    >
      {streaming ? (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
          <span className="relative h-2 w-2 rounded-full bg-emerald-400" />
        </span>
      ) : isLive ? (
        <span className="h-2 w-2 rounded-full bg-cyan-400" />
      ) : (
        <span className="h-2 w-2 rounded-full bg-slate-600" />
      )}
      {streaming ? `Stream · ${timeStr}` : isLive ? `Live · ${timeStr}` : label ?? "Offline"}
    </div>
  );
}

/** WebSocket stream status strip for command-center panels. */
export function StreamBadge({ isStreaming, streamStatus, lastUpdated }) {
  const reconnecting = Object.values(streamStatus ?? {}).some(
    (s) => s === "reconnecting" || s === "connecting",
  );
  const pulseKey = lastUpdated?.getTime?.() ?? "off";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <LiveBadge
        isLive={!reconnecting}
        isStreaming={isStreaming && !reconnecting}
        lastUpdated={lastUpdated}
        label={reconnecting ? "Reconnecting" : "Offline"}
      />
      {isStreaming ? (
        <span
          key={pulseKey}
          className="inline-flex items-center gap-1 rounded-md border border-violet-500/25 bg-violet-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-violet-300"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
          WS
        </span>
      ) : null}
      {reconnecting ? (
        <span className="text-[9px] font-semibold uppercase tracking-wider text-amber-400/90">
          Reconnecting…
        </span>
      ) : null}
    </div>
  );
}
