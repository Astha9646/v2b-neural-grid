import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("Dashboard ErrorBoundary:", error, info);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
          <div className="max-w-md rounded-2xl border border-rose-500/30 bg-slate-900/80 p-8 text-center backdrop-blur-md">
            <p className="text-sm font-semibold uppercase tracking-wider text-rose-400">
              Dashboard recovered
            </p>
            <h1 className="mt-2 text-xl font-bold text-white">Something went wrong</h1>
            <p className="mt-3 text-sm text-slate-400">
              The Neural Grid UI hit an unexpected error. Telemetry may be incomplete or the API
              returned an unexpected shape.
            </p>
            {this.state.error?.message ? (
              <p className="mt-4 rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-slate-500">
                {this.state.error.message}
              </p>
            ) : null}
            <button
              type="button"
              onClick={this.handleRetry}
              className="mt-6 rounded-xl bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-400"
            >
              Reload dashboard
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
