import { memo } from "react";
import MetricCards from "../components/MetricCards";
import SOCChart from "../components/SOCChart";
import LoadChart from "../components/LoadChart";
import ChargingChart from "../components/ChargingChart";
import EnergyFlowPanel from "../components/EnergyFlowPanel";
import DecisionPanel from "../components/DecisionPanel";
import OptimizationPanel from "../components/OptimizationPanel";
import ForecastChart from "../components/ForecastChart";
import RenewableForecastPanel from "../components/RenewableForecastPanel";
import PeakPredictionPanel from "../components/PeakPredictionPanel";
import FleetTable from "../components/FleetTable";
import SolarPanel from "../components/SolarPanel";
import BatteryHealthPanel from "../components/BatteryHealthPanel";
import NotificationPanel from "../components/NotificationPanel";
import ActivityFeed from "../components/ActivityFeed";
import SystemHealthPanel from "../components/SystemHealthPanel";
import InfrastructureMetrics from "../components/InfrastructureMetrics";
import PerformancePanel from "../components/PerformancePanel";

function SectionHeader({ eyebrow, title, description }) {
  return (
    <header className="mb-5 min-w-0">
      {eyebrow ? <p className="section-eyebrow">{eyebrow}</p> : null}
      <h2 className="section-heading">{title}</h2>
      {description ? <p className="section-subheading">{description}</p> : null}
    </header>
  );
}

function AnalyticsPage() {
  return (
    <div className="min-w-0 space-y-12 viz-page">
      <header className="min-w-0">
        <p className="section-eyebrow">Deep Analytics</p>
        <h1 className="font-display text-2xl font-bold text-white">Grid Analytics Deck</h1>
        <p className="section-subheading">Full telemetry charts, AI panels, fleet ops, and observability</p>
      </header>

      <MetricCards hideHeader />

      <section>
        <SectionHeader eyebrow="Charts" title="Core Analytics" description="Live charging, demand, and energy intelligence" />
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
          <SOCChart className="min-h-[420px]" />
          <LoadChart className="min-h-[420px]" />
        </div>
        <div className="mt-8 grid grid-cols-1 gap-8 2xl:grid-cols-5">
          <div className="2xl:col-span-3">
            <ChargingChart className="min-h-[440px]" />
          </div>
          <div className="2xl:col-span-2">
            <EnergyFlowPanel className="h-full" />
          </div>
        </div>
      </section>

      <section>
        <SectionHeader eyebrow="Intelligence" title="AI Optimization" />
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
          <DecisionPanel />
          <OptimizationPanel />
        </div>
      </section>

      <section>
        <SectionHeader eyebrow="Forecasting" title="Predictive Intelligence" />
        <ForecastChart className="mb-8" />
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
          <RenewableForecastPanel />
          <PeakPredictionPanel />
        </div>
      </section>

      <section>
        <SectionHeader eyebrow="Fleet" title="EV Fleet Operations" />
        <FleetTable />
      </section>

      <section>
        <SectionHeader eyebrow="Sustainability" title="Renewables & Battery Health" />
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <SolarPanel />
          <BatteryHealthPanel />
        </div>
      </section>

      <section id="alerts">
        <SectionHeader eyebrow="Observability" title="Infrastructure & Alerts" />
        <InfrastructureMetrics className="mb-8" />
        <div className="mb-8 grid grid-cols-1 gap-8 xl:grid-cols-2">
          <PerformancePanel />
          <SystemHealthPanel />
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <NotificationPanel compact />
          <ActivityFeed compact />
        </div>
      </section>
    </div>
  );
}

export default memo(AnalyticsPage);
