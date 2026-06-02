import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "../context/AuthContext";
import AuthLoadingScreen from "./AuthLoadingScreen";

/**
 * Redirect authenticated users away from login/signup.
 */
export default function GuestRoute({ children }) {
  const { status, isAuthenticated } = useAuth();
  const location = useLocation();
  const from = location.state?.from ?? "/dashboard";

  if (status === "loading") {
    return <AuthLoadingScreen message="Checking session…" />;
  }

  if (isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  return children;
}
