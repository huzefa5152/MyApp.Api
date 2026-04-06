// main.tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./contexts/AuthContext";
import { CompanyProvider } from "./contexts/CompanyContext";
import ErrorBoundary from "./Components/ErrorBoundary";
import NotificationProvider from "./Components/NotificationProvider";
import ConfirmProvider from "./Components/ConfirmDialog";
import "bootstrap/dist/css/bootstrap.min.css";
import "./index.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Root container missing in index.html");
}

const root = createRoot(container);

root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <NotificationProvider>
          <ConfirmProvider>
            <AuthProvider>
              <CompanyProvider>
                <App />
              </CompanyProvider>
            </AuthProvider>
          </ConfirmProvider>
        </NotificationProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
