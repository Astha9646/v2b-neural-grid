import ChargingChart from "../components/ChargingChart";
import SOCChart from "../components/SOCChart";
import OptimizationPanel from "../components/OptimizationPanel";

export default function ChargingPage() {
  return (
    <div className="min-w-0 space-y-8">
      <header className="min-w-0">
        <p className="section-eyebrow">Charging</p>
        <h1 className="font-display text-2xl font-bold text-white">Charging Control</h1>
        <p className="section-subheading">SOC trajectory, charger utilization, and DDPG optimization</p>
      </header>
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
        <ChargingChart className="min-h-[420px]" />
        <SOCChart className="min-h-[420px]" />
      </div>
      <OptimizationPanel />
    </div>
  );
}
