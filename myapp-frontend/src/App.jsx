// App.jsx
import { Routes, Route } from "react-router-dom";
import DashboardLayout from "./layouts/DashboardLayout";
import PublicLayout from "./layouts/PublicLayout";
import DashboardPage from "./pages/DashboardPage";
import CompanyPage from "./pages/CompanyPage";
import ChallansPage from "./pages/ChallanPage";
import ImportChallansPage from "./pages/ImportChallansPage";
import InvoicePage from "./pages/InvoicePage";
import ItemRateHistoryPage from "./pages/ItemRateHistoryPage";
import PurchaseBillsPage from "./pages/PurchaseBillsPage";
import GoodsReceiptsPage from "./pages/GoodsReceiptsPage";
import StockDashboardPage from "./pages/StockDashboardPage";
import FbrPurchaseImportPage from "./pages/FbrPurchaseImportPage";
import ClientsPage from "./pages/ClientsPage";
import SuppliersPage from "./pages/SuppliersPage";
import ItemTypesPage from "./pages/ItemTypesPage";
import UnitsPage from "./pages/UnitsPage";
import POFormatsPage from "./pages/POFormatsPage";
import ProfilePage from "./pages/ProfilePage";
import UsersPage from "./pages/UsersPage";
import RolesPage from "./pages/RolesPage";
import TenantAccessPage from "./pages/TenantAccessPage";
import TemplateEditorPage from "./pages/TemplateEditorPage";
import AuditLogsPage from "./pages/AuditLogsPage";
import FbrSettingsPage from "./pages/FbrSettingsPage";
import FbrSandboxPage from "./pages/FbrSandboxPage";
import FbrMonitorPage from "./pages/FbrMonitorPage";
import LoginPage from "./pages/public/LoginPage";
import LandingPage from "./pages/public/LandingPage";
import ProtectedRoute from "./Components/ProtectedRoute";
import "./App.css";

export default function App() {
  return (
    <Routes>
      {/* Public website – wrapped in PublicLayout (sticky nav + footer) */}
      <Route element={<PublicLayout />}>
        <Route path="/" element={<LandingPage />} />
      </Route>

      {/* Auth */}
      <Route path="/login" element={<LoginPage />} />

      {/* Protected app routes – auth guard + DashboardLayout */}
      <Route element={<ProtectedRoute />}>
        <Route element={<DashboardLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/companies/*" element={<CompanyPage />} />
          <Route path="/Clients/*" element={<ClientsPage />} />
          <Route path="/Suppliers/*" element={<SuppliersPage />} />
          <Route path="/item-types" element={<ItemTypesPage />} />
          <Route path="/units" element={<UnitsPage />} />
          <Route path="/po-formats" element={<POFormatsPage />} />
          <Route path="/challans" element={<ChallansPage />} />
          <Route path="/challans/import" element={<ImportChallansPage />} />
          {/* Bills tab — pre-FBR data entry. No item-type column, no FBR
              bulk actions, but shows a per-row "Submitted to FBR" badge so
              the operator knows which bills are locked. */}
          {/* Distinct keys force a fresh mount when switching tabs so
              filter state (search, client, dates) doesn't leak between
              modes — and so the ?search= deep-link from a Bill card's
              "Open in Invoices" button always re-seeds the search box. */}
          <Route path="/bills" element={<InvoicePage key="bills" mode="bills" />} />
          {/* Invoices tab — FBR classification & submission. Item-type
              editing + Validate All / Submit All bulk actions live here. */}
          <Route path="/invoices" element={<InvoicePage key="invoices" mode="invoices" />} />
          <Route path="/item-rate-history" element={<ItemRateHistoryPage />} />
          <Route path="/purchase-bills" element={<PurchaseBillsPage />} />
          <Route path="/goods-receipts" element={<GoodsReceiptsPage />} />
          <Route path="/stock" element={<StockDashboardPage />} />
          {/* FBR Annexure-A purchase ledger import — Phase 1 preview only */}
          <Route path="/fbr-import/purchase" element={<FbrPurchaseImportPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/roles" element={<RolesPage />} />
          <Route path="/tenant-access" element={<TenantAccessPage />} />
          <Route path="/templates" element={<TemplateEditorPage />} />
          <Route path="/fbr-settings" element={<FbrSettingsPage />} />
          <Route path="/fbr-sandbox" element={<FbrSandboxPage />} />
          <Route path="/fbr-monitor" element={<FbrMonitorPage />} />
          <Route path="/audit-logs" element={<AuditLogsPage />} />
        </Route>
      </Route>

      {/* Catch-all */}
      <Route path="*" element={<h2 style={{ padding: "2rem" }}>Page Not Found</h2>} />
    </Routes>
  );
}
