// App.jsx
import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
const McpGuidePage = lazy(() => import("./pages/public/McpGuidePage"));
const McpConnectPage = lazy(() => import("./pages/McpConnectPage"));
const AdministratorsPage = lazy(() => import("./pages/AdministratorsPage"));
import DashboardLayout from "./layouts/DashboardLayout";
import PublicLayout from "./layouts/PublicLayout";
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const EmailWorkspacePage = lazy(() => import("./pages/EmailWorkspacePage"));
const CompanyPage = lazy(() => import("./pages/CompanyPage"));
const DivisionsPage = lazy(() => import("./pages/DivisionsPage"));
const ChallansPage = lazy(() => import("./pages/ChallanPage"));
const ImportChallansPage = lazy(() => import("./pages/ImportChallansPage"));
const SalesQuotePage = lazy(() => import("./pages/SalesQuotePage"));
const SalesOrderPage = lazy(() => import("./pages/SalesOrderPage"));
const InvoicePage = lazy(() => import("./pages/InvoicePage"));
const PaymentsPage = lazy(() => import("./pages/PaymentsPage"));
const ChartOfAccountsPage = lazy(() => import("./pages/ChartOfAccountsPage"));
const UserGuidePage = lazy(() => import("./pages/UserGuidePage"));
const BankCashAccountsPage = lazy(() => import("./pages/BankCashAccountsPage"));
const JournalEntriesPage = lazy(() => import("./pages/JournalEntriesPage"));
const TransfersPage = lazy(() => import("./pages/TransfersPage"));
const AccountingDashboardPage = lazy(() => import("./pages/AccountingDashboardPage"));
const AccountingReportsPage = lazy(() => import("./pages/AccountingReportsPage"));
const DataMigrationPage = lazy(() => import("./pages/DataMigrationPage"));
const ManagerImportPage = lazy(() => import("./pages/ManagerImportPage"));
const CreditDebitNotePage = lazy(() => import("./pages/CreditDebitNotePage"));
const ItemRateHistoryPage = lazy(() => import("./pages/ItemRateHistoryPage"));
const PurchaseBillsPage = lazy(() => import("./pages/PurchaseBillsPage"));
const PurchaseDebitNotesPage = lazy(() => import("./pages/PurchaseDebitNotesPage"));
const GoodsReceiptsPage = lazy(() => import("./pages/GoodsReceiptsPage"));
const StockDashboardPage = lazy(() => import("./pages/StockDashboardPage"));
const FbrPurchaseImportPage = lazy(() => import("./pages/FbrPurchaseImportPage"));
const SalesReportPage = lazy(() => import("./pages/SalesReportPage"));
const DocumentLinesPage = lazy(() => import("./pages/DocumentLinesPage"));
import { lineSources } from "./utils/documentLines";
const TaxSheetPage = lazy(() => import("./pages/TaxSheetPage"));
const ClientsPage = lazy(() => import("./pages/ClientsPage"));
const SuppliersPage = lazy(() => import("./pages/SuppliersPage"));
const ItemTypesPage = lazy(() => import("./pages/ItemTypesPage"));
const NonInventoryItemsPage = lazy(() => import("./pages/NonInventoryItemsPage"));
const UnitsPage = lazy(() => import("./pages/UnitsPage"));
const POFormatsPage = lazy(() => import("./pages/POFormatsPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const UsersPage = lazy(() => import("./pages/UsersPage"));
const RolesPage = lazy(() => import("./pages/RolesPage"));
const TenantAccessPage = lazy(() => import("./pages/TenantAccessPage"));
const TemplateEditorPage = lazy(() => import("./pages/TemplateEditorPage"));
const PrintTemplatesPage = lazy(() => import("./pages/PrintTemplatesPage"));
const CustomerPortalsPage = lazy(() => import("./pages/CustomerPortalsPage"));
const AuditLogsPage = lazy(() => import("./pages/AuditLogsPage"));
const FbrSettingsPage = lazy(() => import("./pages/FbrSettingsPage"));
const FbrSandboxPage = lazy(() => import("./pages/FbrSandboxPage"));
const FbrMonitorPage = lazy(() => import("./pages/FbrMonitorPage"));
const NavigationMenuPage = lazy(() => import("./pages/NavigationMenuPage"));
const WithholdingTaxReceiptsPage = lazy(() => import("./pages/WithholdingTaxReceiptsPage"));
import LoginPage from "./pages/public/LoginPage";
import LandingPage from "./pages/public/LandingPage";
import ProtectedRoute from "./Components/ProtectedRoute";
import RequirePermission from "./Components/RequirePermission";
import "./App.css";

export default function App() {
  return (
    <Suspense fallback={null}>
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
      <Route path="/mcp-guide" element={<McpGuidePage />} />

      {/* Protected app routes – auth guard + DashboardLayout */}
      <Route element={<ProtectedRoute />}>
        <Route element={<DashboardLayout />}>
          <Route path="/connect" element={<McpConnectPage />} />
          <Route path="/administrators" element={<AdministratorsPage />} />
          <Route path="/email-workspace" element={<RequirePermission permission="email.workspace.use"><EmailWorkspacePage /></RequirePermission>} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/companies/*" element={<RequirePermission anyPrefix="companies."><CompanyPage /></RequirePermission>} />
          <Route path="/configuration/divisions" element={<RequirePermission anyPrefix="divisions."><DivisionsPage /></RequirePermission>} />
          <Route path="/Clients/*" element={<RequirePermission anyPrefix="clients."><ClientsPage /></RequirePermission>} />
          <Route path="/Suppliers/*" element={<RequirePermission anyPrefix="suppliers."><SuppliersPage /></RequirePermission>} />
          <Route path="/item-types" element={<RequirePermission anyPrefix="itemtypes."><ItemTypesPage /></RequirePermission>} />
          <Route path="/non-inventory-items" element={<RequirePermission anyPrefix="noninventoryitems."><NonInventoryItemsPage /></RequirePermission>} />
          <Route path="/units" element={<RequirePermission anyPrefix="config.units"><UnitsPage /></RequirePermission>} />
          <Route path="/po-formats" element={<RequirePermission anyPrefix="poformats."><POFormatsPage /></RequirePermission>} />
          <Route path="/challans" element={<RequirePermission anyPrefix="challans."><ChallansPage /></RequirePermission>} />
          <Route path="/challans/import" element={<RequirePermission anyPrefix="challans."><ImportChallansPage /></RequirePermission>} />
          {/* Bills tab — pre-FBR data entry. No item-type column, no FBR
              bulk actions, but shows a per-row "Submitted to FBR" badge so
              the operator knows which bills are locked. */}
          {/* Distinct keys force a fresh mount when switching tabs so
              filter state (search, client, dates) doesn't leak between
              modes — and so the ?search= deep-link from a Bill card's
              "Open in Invoices" button always re-seeds the search box. */}
          <Route path="/bills" element={<RequirePermission anyPrefix="bills."><InvoicePage key="bills" mode="bills" /></RequirePermission>} />
          {/* Invoices tab — FBR classification & submission. Item-type
              editing + Validate All / Submit All bulk actions live here. */}
          <Route path="/invoices" element={<RequirePermission anyPrefix="invoices."><InvoicePage key="invoices" mode="invoices" /></RequirePermission>} />
          {/* Sales Quote (priced quotation) + Sales Order (qty-only, drives
              challan fulfilment). Pre-sale documents; not FBR. */}
          <Route path="/sales-quotes" element={<RequirePermission anyPrefix="salesquotes."><SalesQuotePage /></RequirePermission>} />
          <Route path="/sales-orders" element={<RequirePermission anyPrefix="salesorders."><SalesOrderPage /></RequirePermission>} />
          {/* Withholding Tax Receipts — customer-issued tax certificates;
              per-customer sum feeds the Customers screen's WHT-receivable. */}
          <Route path="/withholding-tax" element={<RequirePermission anyPrefix="withholdingtax."><WithholdingTaxReceiptsPage /></RequirePermission>} />
          {/* Credit Notes (returns/reversals) and Debit Notes (upward
              adjustments) — each tab lists ONLY its type, in its own
              numbering sequence. Never mixed with Bills or Invoices.
              The create screen lives at /credit-debit-notes?type=credit|debit. */}
          <Route path="/credit-notes" element={<RequirePermission anyPrefix={["bills.", "invoices."]}><InvoicePage key="creditnotes" mode="creditnotes" /></RequirePermission>} />
          <Route path="/debit-notes" element={<RequirePermission anyPrefix={["bills.", "invoices."]}><InvoicePage key="debitnotes" mode="debitnotes" /></RequirePermission>} />
          <Route path="/credit-debit-notes" element={<RequirePermission anyPrefix="invoices."><CreditDebitNotePage /></RequirePermission>} />
          <Route path="/item-rate-history" element={<RequirePermission anyPrefix="itemratehistory."><ItemRateHistoryPage /></RequirePermission>} />
          {/* Accounting — Receipts (money in) / Payments (money out). Distinct
              keys force a fresh mount when switching modes so filter state
              doesn't leak. */}
          <Route path="/receipts" element={<RequirePermission anyPrefix="accounting.receipts"><PaymentsPage key="receipts" mode="receipts" /></RequirePermission>} />
          <Route path="/payments" element={<RequirePermission anyPrefix="accounting.payments"><PaymentsPage key="payments" mode="payments" /></RequirePermission>} />
          <Route path="/chart-of-accounts" element={<RequirePermission anyPrefix="accounting.coa"><ChartOfAccountsPage /></RequirePermission>} />
          {/* Accounting guide — explains the product, exposes no company data,
              so it needs no permission. */}
          <Route path="/help/accounting" element={<UserGuidePage />} />
          <Route path="/bank-cash-accounts" element={<RequirePermission anyPrefix={["accounting.coa", "accounting.reconciliation"]}><BankCashAccountsPage /></RequirePermission>} />
          {/* General Ledger (Phase B): transfers move money between own
              bank/cash accounts; journal entries are manual GL postings;
              the accounting dashboard + reports read the live ledger. */}
          <Route path="/transfers" element={<RequirePermission anyPrefix="accounting.transfers"><TransfersPage /></RequirePermission>} />
          <Route path="/journal-entries" element={<RequirePermission anyPrefix="accounting.journal"><JournalEntriesPage /></RequirePermission>} />
          <Route path="/accounting/dashboard" element={<RequirePermission anyPrefix="accounting.dashboard"><AccountingDashboardPage /></RequirePermission>} />
          {/* Accounting reports: the bare path is the categorised index, and
              /:reportId opens one report. A separate route rather than an
              optional param — react-router v7 dropped optional-param syntax. */}
          <Route path="/accounting/reports" element={<RequirePermission anyPrefix="accounting.reports"><AccountingReportsPage /></RequirePermission>} />
          <Route path="/accounting/reports/:reportId" element={<RequirePermission anyPrefix="accounting.reports"><AccountingReportsPage /></RequirePermission>} />
          <Route path="/accounting/data-migration" element={<RequirePermission anyPrefix="accounting.import"><DataMigrationPage /></RequirePermission>} />
          <Route path="/accounting/manager-import" element={<RequirePermission anyPrefix="accounting.import"><ManagerImportPage /></RequirePermission>} />
          <Route path="/purchase-bills" element={<RequirePermission anyPrefix="purchasebills."><PurchaseBillsPage /></RequirePermission>} />
          <Route path="/purchase-debit-notes" element={<RequirePermission anyPrefix="purchasedebitnotes."><PurchaseDebitNotesPage /></RequirePermission>} />
          <Route path="/goods-receipts" element={<RequirePermission anyPrefix="goodsreceipts."><GoodsReceiptsPage /></RequirePermission>} />
          <Route path="/stock" element={<RequirePermission anyPrefix="stock."><StockDashboardPage /></RequirePermission>} />
          {/* FBR Annexure-A purchase ledger import — Phase 1 preview only */}
          <Route path="/fbr-import/purchase" element={<RequirePermission anyPrefix="fbrimport."><FbrPurchaseImportPage /></RequirePermission>} />
          {/* Reports */}
          <Route path="/reports/sales" element={<RequirePermission anyPrefix="reports.sales"><SalesReportPage /></RequirePermission>} />
          <Route path="/reports/document-lines" element={<RequirePermission anyOf={Object.values(lineSources).map((source) => source.permission)}><DocumentLinesPage /></RequirePermission>} />
          <Route path="/reports/tax-sheet" element={<RequirePermission anyPrefix="reports.taxsheet"><TaxSheetPage /></RequirePermission>} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/users" element={<RequirePermission anyPrefix="users."><UsersPage /></RequirePermission>} />
          <Route path="/roles" element={<RequirePermission anyPrefix="rbac."><RolesPage /></RequirePermission>} />
          <Route path="/tenant-access" element={<RequirePermission anyPrefix={["tenantaccess.", "divisionaccess."]}><TenantAccessPage /></RequirePermission>} />
          <Route path="/templates" element={<RequirePermission anyPrefix="printtemplates."><PrintTemplatesPage /></RequirePermission>} />
          {/* Internal management only. The PUBLIC portal at /portal/<token> is
              rendered outside this router entirely — see main.jsx. */}
          <Route path="/customer-portals" element={<RequirePermission anyPrefix="customerportal."><CustomerPortalsPage /></RequirePermission>} />
          <Route path="/templates/edit" element={<RequirePermission anyPrefix="printtemplates."><TemplateEditorPage /></RequirePermission>} />
          <Route path="/fbr-settings" element={<RequirePermission anyPrefix={["fbr.config", "fbr.lookup", "fbr.reference"]}><FbrSettingsPage /></RequirePermission>} />
          <Route path="/fbr-sandbox" element={<RequirePermission anyPrefix="fbr.sandbox"><FbrSandboxPage /></RequirePermission>} />
          <Route path="/fbr-monitor" element={<RequirePermission anyPrefix="fbrmonitor."><FbrMonitorPage /></RequirePermission>} />
          <Route path="/configuration/navigation-menu" element={<RequirePermission anyPrefix={["folders.", "attachments."]}><NavigationMenuPage /></RequirePermission>} />
          <Route path="/audit-logs" element={<RequirePermission anyPrefix="auditlogs."><AuditLogsPage /></RequirePermission>} />
        </Route>
      </Route>

      {/* Catch-all */}
      <Route path="*" element={<h2 style={{ padding: "2rem" }}>Page Not Found</h2>} />
    </Routes>
    </Suspense>
  );
}
