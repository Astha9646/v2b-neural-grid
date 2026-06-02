import LoadChart from "../components/LoadChart";
import SOCChart from "../components/SOCChart";
import ChargingChart from "../components/ChargingChart";
import ForecastChart from "../components/ForecastChart";
import RenewableForecastPanel from "../components/RenewableForecastPanel";
import PeakPredictionPanel from "../components/PeakPredictionPanel";
import MetricCards from "../components/MetricCards";

export default function AnalyticsPage() {
  return (
    <div className="min-w-0 space-y-8">
      <header className="min-w-0">
        <p className="section-eyebrow">Analytics</p>
        <h1 className="font-display text-2xl font-bold text-white">Grid Analytics</h1>
        <p className="section-subheading">Historical telemetry, forecasts, and KPI trends</p>
      </header>
      <MetricCards hideHeader />
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
        <LoadChart className="min-h-[400px]" />
        <SOCChart className="min-h-[400px]" />
      </div>
      <ChargingChart className="min-h-[420px]" />
      <ForecastChart />
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <RenewableForecastPanel />
        <PeakPredictionPanel />
      </div>
    </div>
  );
}
