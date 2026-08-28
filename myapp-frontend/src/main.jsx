// main.tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./contexts/AuthContext";
import { PermissionsProvider } from "./contexts/PermissionsContext";
import { CompanyProvider } from "./contexts/CompanyContext";
import ErrorBoundary from "./Components/ErrorBoundary";
import NotificationProvider from "./Components/NotificationProvider";
import ConfirmProvider from "./Components/ConfirmDialog";
import PublicPortalPage from "./pages/PublicPortalPage";
import "bootstrap/dist/css/bootstrap.min.css";
import "./index.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Root container missing in index.html");
}

const root = createRoot(container);

// The public Customer Portal renders BEFORE — and outside — the router.
//
// Two reasons it cannot be an ordinary route. The router's basename follows
// Vite's BASE_URL, which is "/admin/" in the customer build, so a link at
// "/portal/<token>" would never match any route there. And the portal must not
// sit inside AuthProvider / PermissionsProvider / CompanyProvider: those fetch
// the current user on mount, which for an anonymous visitor means a 401 storm
// and a bounce to the operator login page.
//
// Everything the portal needs it fetches itself through api/portalApi.js.
const isPublicPortal = /^\/portal\/[A-Za-z0-9_-]+/.test(window.location.pathname);

if (isPublicPortal) {
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <PublicPortalPage />
      </ErrorBoundary>
    </React.StrictMode>
  );
} else {
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      {/* basename follows Vite's base ("/admin/" in this build) so the
          whole app — routes, links, navigate() — is /admin-rooted. */}
      <BrowserRouter basename={(import.meta.env.BASE_URL || "/").replace(/\/+$/, "") || "/"}>
        <NotificationProvider>
          <ConfirmProvider>
            <AuthProvider>
              <PermissionsProvider>
                <CompanyProvider>
                  <App />
                </CompanyProvider>
              </PermissionsProvider>
            </AuthProvider>
          </ConfirmProvider>
        </NotificationProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
}
