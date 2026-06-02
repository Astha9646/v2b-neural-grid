import FleetTable from "../components/FleetTable";
import MetricCards from "../components/MetricCards";

export default function FleetPage() {
  return (
    <div className="min-w-0 space-y-8">
      <header className="min-w-0">
        <p className="section-eyebrow">Fleet</p>
        <h1 className="font-display text-2xl font-bold text-white">EV Fleet Operations</h1>
        <p className="section-subheading">Live heterogeneous charger fleet · WebSocket telemetry</p>
      </header>
      <MetricCards hideHeader />
      <div className="min-w-0 overflow-x-auto">
        <FleetTable />
      </div>
    </div>
  );
}
