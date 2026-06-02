import DecisionPanel from "../components/DecisionPanel";
import OptimizationPanel from "../components/OptimizationPanel";
import ActivityFeed from "../components/ActivityFeed";

export default function AiDecisionsPage() {
  return (
    <div className="min-w-0 space-y-8">
      <header className="min-w-0">
        <p className="section-eyebrow">AI</p>
        <h1 className="font-display text-2xl font-bold text-white">AI Decisions</h1>
        <p className="section-subheading">Explainable DDPG policy · XAI reasoning · optimization masks</p>
      </header>
      <DecisionPanel />
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
        <OptimizationPanel />
        <ActivityFeed />
      </div>
    </div>
  );
}
