import ForecastChart from "../components/ForecastChart";
import RenewableForecastPanel from "../components/RenewableForecastPanel";
import PeakPredictionPanel from "../components/PeakPredictionPanel";
import SolarPanel from "../components/SolarPanel";
import WeatherWidget from "../components/weather/WeatherWidget";
import { useWeather } from "../context/WeatherContext";
import { useTwinSlice } from "../hooks/useTelemetrySelectors";

export default function ForecastSustainabilityPage() {
  const { renewableBlend } = useWeather();
  const { latest } = useTwinSlice();
  const telemetryRen = Number(latest?.renewable_ratio ?? 0);
  const blendedPct = Math.round(renewableBlend * 100);
  const telemetryPct = Math.round(telemetryRen * (telemetryRen <= 1 ? 100 : 1));

  return (
    <div className="min-w-0 space-y-8 viz-page">
      <header className="min-w-0">
        <p className="section-eyebrow">Forecast &amp; Sustainability</p>
        <h1 className="font-display text-2xl font-bold text-white">Weather · Renewables · Outlook</h1>
        <p className="section-subheading">
          OpenWeather live data blended with AI forecasting and grid telemetry
        </p>
      </header>

      <WeatherWidget />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Weather-adjusted renewable" value={`${blendedPct}%`} accent />
        <KpiCard label="Telemetry renewable ratio" value={`${telemetryPct}%`} />
        <KpiCard label="Solar generation" value={`${Math.round(Number(latest?.solar_generation_kw) || 0)} kW`} />
      </div>

      <ForecastChart />
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <RenewableForecastPanel />
        <PeakPredictionPanel />
      </div>
      <SolarPanel />
    </div>
  );
}

function KpiCard({ label, value, accent = false }) {
  return (
    <div className="panel-shell glass-viz">
      <p className="metric-label">{label}</p>
      <p className={["metric-value mt-1", accent ? "text-emerald-300" : "text-cyan-200"].join(" ")}>{value}</p>
    </div>
  );
}
