import { memo, useEffect } from "react";

import { Outlet, useLocation } from "react-router-dom";

import Navbar from "../components/Navbar";
import Sidebar from "../components/Sidebar";
import ErrorBoundary from "../components/ErrorBoundary";
import { useAuth } from "../context/AuthContext";
import { TelemetryProvider } from "../context/TelemetryContext";
import { ObservabilityProvider } from "../context/ObservabilityContext";

const ROUTE_TITLES = {
  "/dashboard": "Command Center",
  "/fleet": "Fleet Operations",
  "/charging": "Charging Control",
  "/energy": "Energy Intelligence",
  "/analytics": "Grid Analytics",
  "/ai-decisions": "AI Decisions",
  "/settings": "System Settings",
};

function AppShellInner() {
  const location = useLocation();
  const { sessionKey, isAuthenticated } = useAuth();
  const title = ROUTE_TITLES[location.pathname] ?? "Neural Grid";

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.debug("[Route] mounted:", location.pathname);
    }
  }, [location.pathname]);

  if (!isAuthenticated) {
    return null;
  }

  return (
    <ErrorBoundary>
      <TelemetryProvider key={sessionKey}>
        <ObservabilityProvider pollMs={12_000}>
          <div className="flex min-h-screen bg-grid-dark font-sans text-slate-100">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <Navbar title={`Neural Grid · ${title}`} />
              <main className="relative flex-1 overflow-y-auto overflow-x-hidden">
                <div
                  className="pointer-events-none absolute inset-0 bg-mesh-gradient opacity-30"
                  aria-hidden
                />
                <div className="relative mx-auto max-w-[1680px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
                  <Outlet />
                </div>
              </main>
            </div>
          </div>
        </ObservabilityProvider>
      </TelemetryProvider>
    </ErrorBoundary>
  );
}

const AppShell = memo(AppShellInner);
AppShell.displayName = "AppShell";

export default AppShell;
