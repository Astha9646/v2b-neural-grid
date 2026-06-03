import { memo } from "react";
import MetricCards from "../components/MetricCards";
import { StreamBadge } from "../components/telemetry/TelemetryStates";
import { useStreamMeta } from "../hooks/useTelemetrySelectors";
import SOCChart from "../components/SOCChart";
import LoadChart from "../components/LoadChart";
import ChargingChart from "../components/ChargingChart";
import EnergyFlowPanel from "../components/EnergyFlowPanel";
import DecisionPanel from "../components/DecisionPanel";
import OptimizationPanel from "../components/OptimizationPanel";
import ForecastChart from "../components/ForecastChart";
import RenewableForecastPanel from "../components/RenewableForecastPanel";
import PeakPredictionPanel from "../components/PeakPredictionPanel";
import DigitalTwinPanel from "../components/DigitalTwinPanel";
import FleetTable from "../components/FleetTable";
import SolarPanel from "../components/SolarPanel";
import BatteryHealthPanel from "../components/BatteryHealthPanel";
import NotificationPanel from "../components/NotificationPanel";
import ActivityFeed from "../components/ActivityFeed";
import SystemHealthPanel from "../components/SystemHealthPanel";
import InfrastructureMetrics from "../components/InfrastructureMetrics";
import PerformancePanel from "../components/PerformancePanel";

function SectionHeader({ eyebrow, title, description, action }) {
  return (
    <header className="mb-5 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="section-eyebrow">{eyebrow}</p> : null}
        <h2 className="section-heading break-words">{title}</h2>
        {description ? <p className="section-subheading break-words">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

const GlobalStreamStatus = memo(function GlobalStreamStatus() {
  const { isStreaming, streamStatus, lastUpdated } = useStreamMeta();
  return (
    <StreamBadge isStreaming={isStreaming} streamStatus={streamStatus} lastUpdated={lastUpdated} />
  );
});

function DashboardPage() {
  return (
    <div className="min-w-0 space-y-12 viz-page">
      <section aria-labelledby="section-global">
        <SectionHeader
          eyebrow="Operations overview"
          title="Global System Status"
          description="Real-time smart-grid operational overview via WebSocket streams"
          action={<GlobalStreamStatus />}
        />
        <MetricCards hideHeader />
      </section>

      <section aria-labelledby="section-analytics">
        <SectionHeader
          eyebrow="Analytics"
          title="Core Analytics"
          description="Live charging, demand, and energy intelligence"
        />
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-2 xl:items-stretch">
          <SOCChart className="min-h-[420px]" />
          <LoadChart className="min-h-[420px]" />
        </div>
        <div className="mt-8 grid grid-cols-1 gap-8 2xl:grid-cols-5 2xl:items-stretch">
          <div className="min-w-0 2xl:col-span-3">
            <ChargingChart className="min-h-[440px]" />
          </div>
          <div className="min-w-0 2xl:col-span-2">
            <EnergyFlowPanel className="h-full" />
          </div>
        </div>
      </section>

      <section aria-labelledby="section-ai">
        <SectionHeader
          eyebrow="Intelligence"
          title="AI Intelligence & Optimization"
          description="Explainable reinforcement-learning charging decisions"
        />
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-2 xl:items-start">
          <DecisionPanel />
          <OptimizationPanel />
        </div>
      </section>

      <section aria-labelledby="section-predictive">
        <SectionHeader
          eyebrow="Forecasting"
          title="Predictive Intelligence"
          description="AI-driven load, renewable, and peak-demand forecasting"
        />
        <ForecastChart className="mb-8" />
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-2 xl:items-start">
          <RenewableForecastPanel />
          <PeakPredictionPanel />
        </div>
      </section>

      <section aria-labelledby="section-twin" className="scroll-mt-8">
        <DigitalTwinPanel />
      </section>

      <section aria-labelledby="section-fleet">
        <SectionHeader eyebrow="Fleet" title="EV Fleet Operations" description="Live fleet charging and battery monitoring" />
        <div className="min-w-0 overflow-x-auto rounded-2xl">
          <FleetTable />
        </div>
      </section>

      <section aria-labelledby="section-sustainability">
        <SectionHeader eyebrow="Sustainability" title="Sustainability Intelligence" description="Renewable contribution and battery health" />
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 xl:items-start">
          <SolarPanel />
          <BatteryHealthPanel />
        </div>
      </section>

      <section aria-labelledby="section-infra" className="pb-4">
        <SectionHeader
          eyebrow="Observability"
          title="Infrastructure Monitoring"
          description="Live system health, host metrics, latency, and stream throughput"
        />
        <InfrastructureMetrics className="mb-8" />
        <div className="mb-8 grid grid-cols-1 gap-8 xl:grid-cols-2">
          <PerformancePanel />
          <SystemHealthPanel />
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-2 xl:items-start">
          <div className="min-w-0">
            <NotificationPanel compact />
          </div>
          <div className="min-w-0">
            <ActivityFeed compact />
          </div>
        </div>
      </section>
    </div>
  );
}

export default memo(DashboardPage);
