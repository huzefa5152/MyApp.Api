// App.jsx
import { lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import DashboardLayout from "./layouts/DashboardLayout";
import PublicLayout from "./layouts/PublicLayout";
import ProtectedRoute from "./Components/ProtectedRoute";
// Entry points stay eager (first paint): the public landing + login.
import LoginPage from "./pages/public/LoginPage";
import LandingPage from "./pages/public/LandingPage";
import "./App.css";

// Route-level code splitting (audit H-5, 2026-08-02): each protected page
// loads as its own chunk on first navigation instead of shipping in the
// initial bundle (which was ~3.7 MB — grapesjs, every form, every page). The
// Suspense boundary lives around the DashboardLayout <Outlet/> so the sidebar
// and topbar stay put while a page chunk loads. Behaviour is unchanged — same
// components rendered with the same props, only their delivery is deferred.
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const CompanyPage = lazy(() => import("./pages/CompanyPage"));
const ChallansPage = lazy(() => import("./pages/ChallanPage"));
const ImportChallansPage = lazy(() => import("./pages/ImportChallansPage"));
const InvoicePage = lazy(() => import("./pages/InvoicePage"));
const SalesQuotePage = lazy(() => import("./pages/SalesQuotePage"));
const SalesOrderPage = lazy(() => import("./pages/SalesOrderPage"));
const PaymentsPage = lazy(() => import("./pages/PaymentsPage"));
const NavigationMenuPage = lazy(() => import("./pages/NavigationMenuPage"));
const CreditDebitNotePage = lazy(() => import("./pages/CreditDebitNotePage"));
const ItemRateHistoryPage = lazy(() => import("./pages/ItemRateHistoryPage"));
const PurchaseBillsPage = lazy(() => import("./pages/PurchaseBillsPage"));
const GoodsReceiptsPage = lazy(() => import("./pages/GoodsReceiptsPage"));
const StockDashboardPage = lazy(() => import("./pages/StockDashboardPage"));
const FbrPurchaseImportPage = lazy(() => import("./pages/FbrPurchaseImportPage"));
const SalesReportPage = lazy(() => import("./pages/SalesReportPage"));
const TaxSheetPage = lazy(() => import("./pages/TaxSheetPage"));
const OutstandingLedgerPage = lazy(() => import("./pages/OutstandingLedgerPage"));
const ClientsPage = lazy(() => import("./pages/ClientsPage"));
const SuppliersPage = lazy(() => import("./pages/SuppliersPage"));
const ItemTypesPage = lazy(() => import("./pages/ItemTypesPage"));
const UnitsPage = lazy(() => import("./pages/UnitsPage"));
const POFormatsPage = lazy(() => import("./pages/POFormatsPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const UsersPage = lazy(() => import("./pages/UsersPage"));
const RolesPage = lazy(() => import("./pages/RolesPage"));
const TenantAccessPage = lazy(() => import("./pages/TenantAccessPage"));
const TemplateEditorPage = lazy(() => import("./pages/TemplateEditorPage"));
const PrintTemplatesPage = lazy(() => import("./pages/PrintTemplatesPage"));
const AuditLogsPage = lazy(() => import("./pages/AuditLogsPage"));
const FbrSettingsPage = lazy(() => import("./pages/FbrSettingsPage"));
const FbrSandboxPage = lazy(() => import("./pages/FbrSandboxPage"));
const FbrMonitorPage = lazy(() => import("./pages/FbrMonitorPage"));

export default function App() {
  return (
    <Routes>
      {/* Public website – wrapped in PublicLayout (sticky nav + footer).
          Only rendered when the app owns the site root (base "/", i.e. the
          master deployment). When the app is mounted under /admin (customize
          build), a separate static landing page owns "/" — the in-app
          marketing page (and its product images) is unused there, so "/"
          routes straight to login. BASE_URL is replaced at build time, so
          the unused branch (and LandingPage itself) is dead-code-eliminated
          from the /admin bundle. */}
      {import.meta.env.BASE_URL === "/" ? (
        <Route element={<PublicLayout />}>
          <Route path="/" element={<LandingPage />} />
        </Route>
      ) : (
        <Route path="/" element={<Navigate to="/login" replace />} />
      )}

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
          <Route path="/sales-quotes" element={<SalesQuotePage />} />
          <Route path="/sales-orders" element={<SalesOrderPage />} />
          {/* Receipts (money in) / Payments (money out) — one component,
              mounted twice with distinct keys so filter/search state doesn't
              leak when switching between the two. */}
          <Route path="/receipts" element={<PaymentsPage key="receipts" mode="receipts" />} />
          <Route path="/payments" element={<PaymentsPage key="payments" mode="payments" />} />
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
          {/* Credit Notes (returns/reversals) and Debit Notes (upward
              adjustments) — each tab lists ONLY its type, in its own
              numbering sequence. Never mixed with Bills or Invoices.
              The create screen lives at /credit-debit-notes?type=credit|debit. */}
          <Route path="/credit-notes" element={<InvoicePage key="creditnotes" mode="creditnotes" />} />
          <Route path="/debit-notes" element={<InvoicePage key="debitnotes" mode="debitnotes" />} />
          <Route path="/credit-debit-notes" element={<CreditDebitNotePage />} />
          <Route path="/item-rate-history" element={<ItemRateHistoryPage />} />
          <Route path="/purchase-bills" element={<PurchaseBillsPage />} />
          <Route path="/goods-receipts" element={<GoodsReceiptsPage />} />
          <Route path="/stock" element={<StockDashboardPage />} />
          {/* FBR Annexure-A purchase ledger import — Phase 1 preview only */}
          <Route path="/fbr-import/purchase" element={<FbrPurchaseImportPage />} />
          {/* Reports */}
          <Route path="/reports/sales" element={<SalesReportPage />} />
          <Route path="/reports/tax-sheet" element={<TaxSheetPage />} />
          <Route path="/reports/outstanding" element={<OutstandingLedgerPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/roles" element={<RolesPage />} />
          <Route path="/tenant-access" element={<TenantAccessPage />} />
          <Route path="/templates" element={<PrintTemplatesPage />} />
          <Route path="/templates/edit" element={<TemplateEditorPage />} />
          {/* Configuration → Navigation Menu: the folder document library +
              uploaded attachments (create folders, upload/preview/download). */}
          <Route path="/configuration/navigation-menu" element={<NavigationMenuPage />} />
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
