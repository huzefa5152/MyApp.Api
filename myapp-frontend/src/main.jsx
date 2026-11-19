// main.tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App, { preloadScreenFor } from "./App";
import { AuthProvider } from "./contexts/AuthContext";
import { PermissionsProvider } from "./contexts/PermissionsContext";
import { CompanyProvider } from "./contexts/CompanyContext";
import { UiThemeProvider } from "./ui2/UiThemeContext";
import "./ui/kit.css";
import "./ui2/theme-aurora.css";
import "./ui2/theme-midnight.css";
import ErrorBoundary from "./Components/ErrorBoundary";
import NotificationProvider from "./Components/NotificationProvider";
import ConfirmProvider from "./Components/ConfirmDialog";
import ReconnectingNotice from "./Components/ReconnectingNotice";
import { startVersionWatch } from "./utils/serviceContinuity";
import PublicPortalPage from "./pages/public/PublicPortalPage";
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
// Vite's BASE_URL, which is "/admin/" in this build, so a link at
// "/portal/<token>" would never match any route at all. And the portal must not
// sit inside AuthProvider / PermissionsProvider / CompanyProvider: each fetches
// the current user on mount, which for an anonymous visitor is a 401 storm and
// a bounce to the operator's login page — and the customer has no account to
// log in with.
//
// Everything the portal needs it fetches itself through api/publicPortalApi.js,
// which uses its own credential-free axios client for the same reason.
const isPublicPortal = /^\/portal\/[A-Za-z0-9_-]+/.test(window.location.pathname);

if (isPublicPortal) {
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <PublicPortalPage />
      </ErrorBoundary>
    </React.StrictMode>,
  );
} else {
  startVersionWatch();

  // Fetch a screen's code before it is needed (see utils/lazyScreen.js):
  //  - the screen this page load is heading for, alongside the sign-in check,
  //    for a visitor who has a saved sign-in;
  //  - the screen behind a link, the moment the pointer or focus reaches it.
  // Code only. Nothing renders, and no data is asked for, any earlier.
  const appBase = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");
  const routerPath = (pathname) =>
    (appBase && pathname.startsWith(appBase) ? pathname.slice(appBase.length) : pathname) || "/";
  if (localStorage.getItem("token")) preloadScreenFor(routerPath(window.location.pathname));
  const onIntent = (event) => {
    const link = event.target?.closest?.("a[href]");
    if (link && link.origin === window.location.origin) preloadScreenFor(routerPath(link.pathname));
  };
  for (const type of ["pointerover", "focusin", "touchstart"])
    document.addEventListener(type, onIntent, { passive: true });
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        {/* basename follows Vite's base ("/admin/" in this build) so the
            whole app — routes, links, navigate() — is /admin-rooted. */}
        <ReconnectingNotice />
        <BrowserRouter basename={(import.meta.env.BASE_URL || "/").replace(/\/+$/, "") || "/"}>
          <NotificationProvider>
            <ConfirmProvider>
              <AuthProvider>
                <PermissionsProvider>
                  <CompanyProvider>
                    <UiThemeProvider>
                      <App />
                    </UiThemeProvider>
                  </CompanyProvider>
                </PermissionsProvider>
              </AuthProvider>
            </ConfirmProvider>
          </NotificationProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
