// src/Components/ProtectedRoute.jsx
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export default function ProtectedRoute() {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="d-flex justify-content-center align-items-center vh-100">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    // An AI application sent this visitor to approve a connection ("sign in to
    // connect"): remember the request so that signing in lands back on it.
    if (location.pathname === "/connect") {
      try { sessionStorage.setItem("postLoginReturnTo", location.pathname + location.search); } catch { /* non-fatal */ }
    }
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
