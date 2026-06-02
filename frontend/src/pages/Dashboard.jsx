import Navbar from "../components/Navbar";
import Sidebar from "../components/Sidebar";
import ErrorBoundary from "../components/ErrorBoundary";
import { TelemetryProvider } from "../context/TelemetryContext";

import MetricCards from "../components/MetricCards";
import { StreamBadge } from "../components/telemetry/TelemetryStates";
import { memo } from "react";
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

function SectionHeader({ eyebrow, title, description, action }) {
  return (
    <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow ? <p className="section-eyebrow">{eyebrow}</p> : null}
        <h2 className="section-heading">{title}</h2>
        {description ? <p className="section-subheading">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

const GlobalStreamStatus = memo(function GlobalStreamStatus() {
  const { isStreaming, streamStatus, lastUpdated } = useStreamMeta();
  return (
    <StreamBadge
      isStreaming={isStreaming}
      streamStatus={streamStatus}
      lastUpdated={lastUpdated}
    />
  );
});

export default function Dashboard() {
  return (
    <ErrorBoundary>
    <TelemetryProvider>
    <div className="flex min-h-screen bg-grid-dark font-sans text-slate-100">
      <Sidebar />

      <div className="flex flex-1 flex-col overflow-hidden">
        <Navbar title="Neural Grid Command Center" />

        <main className="relative flex-1 overflow-y-auto">
          <div
            className="pointer-events-none absolute inset-0 bg-mesh-gradient opacity-30"
            aria-hidden
          />

          <div className="relative mx-auto max-w-[1680px] space-y-12 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">

            {/* 1. Global status */}
            <section aria-labelledby="section-global">
              <SectionHeader
                eyebrow="Operations overview"
                title="Global System Status"
                description="Real-time smart-grid operational overview via WebSocket streams"
                action={<GlobalStreamStatus />}
              />
              <MetricCards hideHeader />
            </section>

            {/* 2. Core analytics — visually dominant */}
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
                <div className="2xl:col-span-3">
                  <ChargingChart className="min-h-[440px]" />
                </div>
                <div className="2xl:col-span-2">
                  <EnergyFlowPanel className="h-full" />
                </div>
              </div>
            </section>

            {/* 3. AI intelligence */}
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

            {/* 4. Predictive intelligence */}
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

            {/* 5. Digital twin operations */}
            <section aria-labelledby="section-twin" className="scroll-mt-8">
              <DigitalTwinPanel />
            </section>

            {/* 6. Fleet operations */}
            <section aria-labelledby="section-fleet">
              <SectionHeader
                eyebrow="Fleet"
                title="EV Fleet Operations"
                description="Live fleet charging and battery monitoring"
              />

              <div className="overflow-x-auto rounded-2xl">
                <FleetTable />
              </div>
            </section>

            {/* 7. Sustainability */}
            <section aria-labelledby="section-sustainability">
              <SectionHeader
                eyebrow="Sustainability"
                title="Sustainability Intelligence"
                description="Renewable contribution and battery health"
              />

              <div className="grid grid-cols-1 gap-8 xl:grid-cols-2 xl:items-start">
                <SolarPanel />
                <BatteryHealthPanel />
              </div>
            </section>

            {/* 8. Infrastructure monitoring — compact, secondary */}
            <section aria-labelledby="section-infra" className="pb-4">
              <SectionHeader
                eyebrow="Monitoring"
                title="Infrastructure Monitoring"
                description="Alerts, activity log, and platform health"
              />

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-12 xl:items-start">
                <div className="lg:col-span-1 xl:col-span-5">
                  <NotificationPanel compact />
                </div>
                <div className="lg:col-span-1 xl:col-span-4">
                  <ActivityFeed compact />
                </div>
                <div className="lg:col-span-2 xl:col-span-3">
                  <SystemHealthPanel compact />
                </div>
              </div>
            </section>

          </div>
        </main>
      </div>
    </div>
    </TelemetryProvider>
    </ErrorBoundary>
  );
}
