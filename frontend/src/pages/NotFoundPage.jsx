import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <div className="panel-shell mx-auto max-w-lg text-center">
      <h1 className="font-display text-2xl font-bold text-white">Route not found</h1>
      <p className="mt-2 text-sm text-slate-400">This command-center view does not exist.</p>
      <Link
        to="/dashboard"
        className="mt-6 inline-block rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-500/20"
      >
        Return to Command Center
      </Link>
    </div>
  );
}
