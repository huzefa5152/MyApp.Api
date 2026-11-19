import McpGuidePage from "./pages/public/McpGuidePage";
// App.jsx
import { Routes, Route, Navigate, createRoutesFromElements, matchRoutes } from "react-router-dom";
import { lazyScreen } from "./utils/lazyScreen";
import DashboardLayout from "./layouts/DashboardLayout";
import PublicLayout from "./layouts/PublicLayout";
const DashboardPage = lazyScreen(() => import("./pages/DashboardPage"));
const CompanyPage = lazyScreen(() => import("./pages/CompanyPage"));
const ChallansPage = lazyScreen(() => import("./pages/ChallanPage"));
const ImportChallansPage = lazyScreen(() => import("./pages/ImportChallansPage"));
const InvoicePage = lazyScreen(() => import("./pages/InvoicePage"));
const SalesQuotePage = lazyScreen(() => import("./pages/SalesQuotePage"));
const EmailWorkspacePage = lazyScreen(() => import("./pages/EmailWorkspacePage"));
const SalesOrderPage = lazyScreen(() => import("./pages/SalesOrderPage"));
const WithholdingTaxReceiptsPage = lazyScreen(() => import("./pages/WithholdingTaxReceiptsPage"));
const BankCashAccountsPage = lazyScreen(() => import("./pages/BankCashAccountsPage"));
const TransfersPage = lazyScreen(() => import("./pages/TransfersPage"));
const PurchaseDebitNotesPage = lazyScreen(() => import("./pages/PurchaseDebitNotesPage"));
const PaymentsPage = lazyScreen(() => import("./pages/PaymentsPage"));
const ChartOfAccountsPage = lazyScreen(() => import("./pages/ChartOfAccountsPage"));
const JournalEntriesPage = lazyScreen(() => import("./pages/JournalEntriesPage"));
const AccountingDashboardPage = lazyScreen(() => import("./pages/AccountingDashboardPage"));
const UserGuidePage = lazyScreen(() => import("./pages/UserGuidePage"));
const AccountingReportsPage = lazyScreen(() => import("./pages/AccountingReportsPage"));
const AccountingCatalogPage = lazyScreen(() => import("./pages/AccountingCatalogPage"));
const CustomerPortalsPage = lazyScreen(() => import("./pages/CustomerPortalsPage"));
const NavigationMenuPage = lazyScreen(() => import("./pages/NavigationMenuPage"));
const CreditDebitNotePage = lazyScreen(() => import("./pages/CreditDebitNotePage"));
const ItemRateHistoryPage = lazyScreen(() => import("./pages/ItemRateHistoryPage"));
const SupplierPayablesPage = lazyScreen(() => import("./pages/SupplierPayablesPage"));
const PurchaseBillsPage = lazyScreen(() => import("./pages/PurchaseBillsPage"));
const GoodsReceiptsPage = lazyScreen(() => import("./pages/GoodsReceiptsPage"));
const StockDashboardPage = lazyScreen(() => import("./pages/StockDashboardPage"));
const FbrPurchaseImportPage = lazyScreen(() => import("./pages/FbrPurchaseImportPage"));
const OnboardingImportPage = lazyScreen(() => import("./pages/OnboardingImportPage"));
const SalesReportPage = lazyScreen(() => import("./pages/SalesReportPage"));
const DocumentLinesPage = lazyScreen(() => import("./pages/DocumentLinesPage"));
const InvoiceSalesDetailPage = lazyScreen(() => import("./pages/InvoiceSalesDetailPage"));
const ReadyForFbrPage = lazyScreen(() => import("./pages/ReadyForFbrPage"));
const TaxSheetPage = lazyScreen(() => import("./pages/TaxSheetPage"));
const OutstandingLedgerPage = lazyScreen(() => import("./pages/OutstandingLedgerPage"));
const ClientsPage = lazyScreen(() => import("./pages/ClientsPage"));
const SuppliersPage = lazyScreen(() => import("./pages/SuppliersPage"));
const ItemTypesPage = lazyScreen(() => import("./pages/ItemTypesPage"));
const UnitsPage = lazyScreen(() => import("./pages/UnitsPage"));
const POFormatsPage = lazyScreen(() => import("./pages/POFormatsPage"));
const ProfilePage = lazyScreen(() => import("./pages/ProfilePage"));
const McpConnectPage = lazyScreen(() => import("./pages/McpConnectPage"));
const UsersPage = lazyScreen(() => import("./pages/UsersPage"));
const RolesPage = lazyScreen(() => import("./pages/RolesPage"));
const TenantAccessPage = lazyScreen(() => import("./pages/TenantAccessPage"));
const AdministratorsPage = lazyScreen(() => import("./pages/AdministratorsPage"));
const TemplateEditorPage = lazyScreen(() => import("./pages/TemplateEditorPage"));
const PrintTemplatesPage = lazyScreen(() => import("./pages/PrintTemplatesPage"));
const AuditLogsPage = lazyScreen(() => import("./pages/AuditLogsPage"));
const FbrSettingsPage = lazyScreen(() => import("./pages/FbrSettingsPage"));
const FbrSandboxPage = lazyScreen(() => import("./pages/FbrSandboxPage"));
const FbrMonitorPage = lazyScreen(() => import("./pages/FbrMonitorPage"));
import LoginPage from "./pages/public/LoginPage";
import LandingPage from "./pages/public/LandingPage";
import ProtectedRoute from "./Components/ProtectedRoute";
import RequirePermission from "./Components/RequirePermission";
import "./App.css";

// The route list is a constant so the same list can answer "which screen is at
// this path?" before anything renders (preloadScreenFor below).
const appRoutes = (
  <>
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

    {/* NOTE: the PUBLIC customer portal at /portal/<token> is NOT routed
        here. It renders in main.jsx, before and outside this router — the
        router's basename is "/admin" so the path could never match, and the
        portal must stay outside the auth providers. */}

    {/* Protected app routes – auth guard + DashboardLayout */}
    <Route element={<ProtectedRoute />}>
      <Route element={<DashboardLayout />}>
        {/* Every screen below is gated on the permission
            `config/routePermissions.js` records for its path. Hiding the
            sidebar link was never enough — the URL still worked, and a
            page that mounts without its permissions just fills up with
            403s. Fails closed: a path with no entry is refused. */}
        <Route element={<RequirePermission />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/companies/*" element={<CompanyPage />} />
          <Route path="/Clients/*" element={<ClientsPage />} />
          <Route path="/Suppliers/*" element={<SuppliersPage />} />
          <Route path="/item-types" element={<ItemTypesPage />} />
          <Route path="/import-data" element={<OnboardingImportPage />} />
          <Route path="/units" element={<UnitsPage />} />
          <Route path="/po-formats" element={<POFormatsPage />} />
          <Route path="/challans" element={<ChallansPage />} />
          <Route path="/challans/import" element={<ImportChallansPage />} />
          <Route path="/sales-quotes" element={<SalesQuotePage />} />
          <Route path="/email-workspace" element={<EmailWorkspacePage />} />
          <Route path="/withholding-tax-receipts" element={<WithholdingTaxReceiptsPage />} />
          <Route path="/sales-orders" element={<SalesOrderPage />} />
          {/* Receipts (money in) / Payments (money out) — one component,
              mounted twice with distinct keys so filter/search state doesn't
              leak when switching between the two. */}
          <Route path="/bank-cash-accounts" element={<BankCashAccountsPage />} />
          <Route path="/transfers" element={<TransfersPage />} />
          <Route path="/purchase-debit-notes" element={<PurchaseDebitNotesPage />} />
          <Route path="/receipts" element={<PaymentsPage key="receipts" mode="receipts" />} />
          <Route path="/payments" element={<PaymentsPage key="payments" mode="payments" />} />
          <Route path="/chart-of-accounts" element={<ChartOfAccountsPage />} />
          <Route path="/journal-entries" element={<JournalEntriesPage />} />
          <Route path="/accounting/dashboard" element={<AccountingDashboardPage />} />
          {/* The old Accounting → Overview address, kept so bookmarks land on
              its replacement, Dashboards → Accounting. */}
          <Route
            path="/accounting/overview"
            element={<Navigate to="/accounting/dashboard" replace />}
          />
          <Route path="/help/accounting" element={<UserGuidePage />} />
          <Route path="/accounting/reports" element={<AccountingReportsPage />} />
          <Route path="/accounting/reports/catalog" element={<AccountingCatalogPage />} />
          <Route path="/accounting/reports/catalog/:reportId" element={<AccountingCatalogPage />} />
          <Route path="/customer-portals" element={<CustomerPortalsPage />} />
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
          <Route
            path="/credit-notes"
            element={<InvoicePage key="creditnotes" mode="creditnotes" />}
          />
          <Route path="/debit-notes" element={<InvoicePage key="debitnotes" mode="debitnotes" />} />
          <Route path="/credit-debit-notes" element={<CreditDebitNotePage />} />
          <Route path="/item-rate-history" element={<ItemRateHistoryPage />} />
          <Route path="/supplier-payables" element={<SupplierPayablesPage />} />
          <Route path="/purchase-bills" element={<PurchaseBillsPage />} />
          <Route path="/goods-receipts" element={<GoodsReceiptsPage />} />
          <Route path="/stock" element={<StockDashboardPage />} />
          {/* FBR Annexure-A purchase ledger import — Phase 1 preview only */}
          <Route path="/fbr-import/purchase" element={<FbrPurchaseImportPage />} />
          {/* Reports */}
          <Route path="/reports/sales" element={<SalesReportPage />} />
          <Route path="/reports/document-lines" element={<DocumentLinesPage />} />
          <Route path="/reports/invoice-sales-detail" element={<InvoiceSalesDetailPage />} />
          <Route path="/reports/ready-for-fbr" element={<ReadyForFbrPage />} />
          <Route path="/reports/tax-sheet" element={<TaxSheetPage />} />
          <Route path="/reports/outstanding" element={<OutstandingLedgerPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/connect" element={<McpConnectPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/roles" element={<RolesPage />} />
          <Route path="/tenant-access" element={<TenantAccessPage />} />
          <Route path="/administrators" element={<AdministratorsPage />} />
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
    </Route>

    {/* Catch-all */}
    <Route path="*" element={<h2 style={{ padding: "2rem" }}>Page Not Found</h2>} />
  </>
);

let routeTable = null;

// Start fetching the code of the screen at `pathname` (router-relative, no
// /admin). Only the code: the screen still renders behind ProtectedRoute and
// RequirePermission exactly as before, and a path that matches no screen does
// nothing.
// eslint-disable-next-line react-refresh/only-export-components
export function preloadScreenFor(pathname) {
  routeTable ??= createRoutesFromElements(appRoutes);
  for (const match of matchRoutes(routeTable, pathname) || [])
    match.route.element?.type?.preload?.();
}

export default function App() {
  return <Routes>{appRoutes}</Routes>;
}
