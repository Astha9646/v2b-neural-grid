import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";

import ProtectedRoute from "./auth/ProtectedRoute";
import GuestRoute from "./auth/GuestRoute";
import { AuthProvider } from "./context/AuthContext";
import AppShell from "./layouts/AppShell";
import Login from "./pages/Login";
import Signup from "./pages/Signup";

const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const FleetPage = lazy(() => import("./pages/FleetPage"));
const ChargingPage = lazy(() => import("./pages/ChargingPage"));
const EnergyPage = lazy(() => import("./pages/EnergyPage"));
const AnalyticsPage = lazy(() => import("./pages/AnalyticsPage"));
const AiDecisionsPage = lazy(() => import("./pages/AiDecisionsPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const ReportCenter = lazy(() => import("./pages/ReportCenter"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));

function RouteFallback() {
  return (
    <div
      className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500"
      role="status"
      aria-live="polite"
    >
      Loading view…
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route
            path="/login"
            element={
              <GuestRoute>
                <Login />
              </GuestRoute>
            }
          />
          <Route
            path="/signup"
            element={
              <GuestRoute>
                <Signup />
              </GuestRoute>
            }
          />

          <Route
            element={
              <ProtectedRoute>
                <AppShell />
              </ProtectedRoute>
            }
          >
            <Route
              path="/dashboard"
              element={
                <Suspense fallback={<RouteFallback />}>
                  <DashboardPage />
                </Suspense>
              }
            />
            <Route
              path="/fleet"
              element={
                <Suspense fallback={<RouteFallback />}>
                  <FleetPage />
                </Suspense>
              }
            />
            <Route
              path="/charging"
              element={
                <Suspense fallback={<RouteFallback />}>
                  <ChargingPage />
                </Suspense>
              }
            />
            <Route
              path="/energy"
              element={
                <Suspense fallback={<RouteFallback />}>
                  <EnergyPage />
                </Suspense>
              }
            />
            <Route
              path="/analytics"
              element={
                <Suspense fallback={<RouteFallback />}>
                  <AnalyticsPage />
                </Suspense>
              }
            />
            <Route
              path="/ai-decisions"
              element={
                <Suspense fallback={<RouteFallback />}>
                  <AiDecisionsPage />
                </Suspense>
              }
            />
            <Route
              path="/reports"
              element={
                <Suspense fallback={<RouteFallback />}>
                  <ReportCenter />
                </Suspense>
              }
            />
            <Route
              path="/settings"
              element={
                <Suspense fallback={<RouteFallback />}>
                  <SettingsPage />
                </Suspense>
              }
            />
            <Route
              path="*"
              element={
                <Suspense fallback={<RouteFallback />}>
                  <NotFoundPage />
                </Suspense>
              }
            />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
