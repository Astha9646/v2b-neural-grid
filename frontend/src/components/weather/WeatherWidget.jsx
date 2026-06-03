import { memo } from "react";

import { useWeather } from "../../context/WeatherContext";

const ICON_MAP = {
  Clear: "☀",
  Clouds: "☁",
  Rain: "🌧",
  Drizzle: "🌦",
  Thunderstorm: "⛈",
  Snow: "❄",
  Mist: "🌫",
  Fog: "🌫",
};

function WeatherWidget({ className = "", compact = false }) {
  const { weather, loading, refresh, renewableBlend } = useWeather();
  const icon = ICON_MAP[weather?.condition] ?? "🌡";

  return (
    <section
      className={[
        "panel-shell panel-shell-accent glass-viz relative overflow-hidden",
        compact ? "p-3" : "",
        className,
      ].join(" ")}
      aria-live="polite"
    >
      <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-cyan-500/10 blur-2xl" />
      <header className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="section-eyebrow">Live Weather</p>
          <h2 className="section-heading text-base">Grid Atmosphere</h2>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="rounded-lg border border-cyan-400/20 px-2 py-1 text-[10px] uppercase tracking-wider text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-50"
        >
          Sync
        </button>
      </header>

      {loading && !weather ? (
        <div className="h-16 animate-pulse rounded-xl bg-white/5" />
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <span className="text-3xl drop-shadow-[0_0_12px_rgba(34,211,238,0.45)]">{icon}</span>
            <div>
              <p className="metric-value text-cyan-200">{weather?.tempC ?? "—"}°C</p>
              <p className="text-xs capitalize text-slate-400">{weather?.description ?? weather?.condition}</p>
            </div>
          </div>
          {!compact && (
            <>
              <Stat label="Humidity" value={`${weather?.humidity ?? "—"}%`} />
              <Stat label="Clouds" value={`${weather?.clouds ?? "—"}%`} />
              <Stat label="Wind" value={`${weather?.windMs ?? "—"} m/s`} />
              <Stat label="Solar IRR" value={`${Math.round((weather?.solarIrradiance ?? 0) * 100)}%`} accent />
              <Stat label="Renewable blend" value={`${Math.round(renewableBlend * 100)}%`} accent />
            </>
          )}
        </div>
      )}
      {weather?.isDemo ? (
        <p className="mt-2 text-[10px] text-amber-400/80">Demo mode — set VITE_OPENWEATHER_API_KEY</p>
      ) : null}
    </section>
  );
}

function Stat({ label, value, accent = false }) {
  return (
    <div>
      <p className="metric-label">{label}</p>
      <p className={["text-sm font-semibold tabular-nums", accent ? "text-emerald-300" : "text-slate-200"].join(" ")}>
        {value}
      </p>
    </div>
  );
}

export default memo(WeatherWidget);
