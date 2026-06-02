import EnergyFlowPanel from "../components/EnergyFlowPanel";
import SolarPanel from "../components/SolarPanel";
import BatteryHealthPanel from "../components/BatteryHealthPanel";
import DigitalTwinPanel from "../components/DigitalTwinPanel";

export default function EnergyPage() {
  return (
    <div className="min-w-0 space-y-8">
      <header className="min-w-0">
        <p className="section-eyebrow">Energy</p>
        <h1 className="font-display text-2xl font-bold text-white">Energy Intelligence</h1>
        <p className="section-subheading">Solar, storage, flows, and digital twin topology</p>
      </header>
      <EnergyFlowPanel />
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <SolarPanel />
        <BatteryHealthPanel />
      </div>
      <DigitalTwinPanel />
    </div>
  );
}
