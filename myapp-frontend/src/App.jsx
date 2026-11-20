// App.jsx
import { Children, isValidElement, Suspense } from "react";
import {
  Routes,
  Route,
  Navigate,
  useLocation,
  createRoutesFromElements,
  matchRoutes,
} from "react-router-dom";
import { lazyScreen } from "./utils/lazyScreen";
import DashboardLayout from "./layouts/DashboardLayout";
import PublicLayout from "./layouts/PublicLayout";
import LoginPage from "./pages/public/LoginPage";
import McpGuidePage from "./pages/public/McpGuidePage";
import LandingPage from "./pages/public/LandingPage";
import ProtectedRoute from "./Components/ProtectedRoute";
import RequirePermission from "./Components/RequirePermission";
import "./App.css";

// Every signed-in screen is loaded on demand, so the first page load does not
// download and parse all of them (one 4.9 MB bundle before 2026-11-20).
// lazyScreen also lets main.jsx fetch a screen's code before it is shown.
const CompanyPage = lazyScreen(() => import("./pages/CompanyPage"));
const DivisionsPage = lazyScreen(() => import("./pages/DivisionsPage"));
const ChallansPage = lazyScreen(() => import("./pages/ChallanPage"));
const ImportChallansPage = lazyScreen(() => import("./pages/ImportChallansPage"));
const SalesQuotePage = lazyScreen(() => import("./pages/SalesQuotePage"));
const SalesOrderPage = lazyScreen(() => import("./pages/SalesOrderPage"));
const InvoicePage = lazyScreen(() => import("./pages/InvoicePage"));
const PaymentsPage = lazyScreen(() => import("./pages/PaymentsPage"));
const CustomerLedgerPage = lazyScreen(() => import("./pages/CustomerLedgerPage"));
const ChartOfAccountsPage = lazyScreen(() => import("./pages/ChartOfAccountsPage"));
const UserGuidePage = lazyScreen(() => import("./pages/UserGuidePage"));
const BankCashAccountsPage = lazyScreen(() => import("./pages/BankCashAccountsPage"));
const JournalEntriesPage = lazyScreen(() => import("./pages/JournalEntriesPage"));
const TransfersPage = lazyScreen(() => import("./pages/TransfersPage"));
const AccountingReportsPage = lazyScreen(() => import("./pages/AccountingReportsPage"));
const DataMigrationPage = lazyScreen(() => import("./pages/DataMigrationPage"));
const ManagerImportPage = lazyScreen(() => import("./pages/ManagerImportPage"));
const SpreadsheetImportPage = lazyScreen(() => import("./pages/SpreadsheetImportPage"));
const CreditDebitNotePage = lazyScreen(() => import("./pages/CreditDebitNotePage"));
const ItemRateHistoryPage = lazyScreen(() => import("./pages/ItemRateHistoryPage"));
const PurchaseBillsPage = lazyScreen(() => import("./pages/PurchaseBillsPage"));
const PurchaseDebitNotesPage = lazyScreen(() => import("./pages/PurchaseDebitNotesPage"));
const GoodsReceiptsPage = lazyScreen(() => import("./pages/GoodsReceiptsPage"));
const StockDashboardPage = lazyScreen(() => import("./pages/StockDashboardPage"));
const StockReconcilePage = lazyScreen(() => import("./pages/StockReconcilePage"));
const StockSplitPage = lazyScreen(() => import("./pages/StockSplitPage"));
const FbrPurchaseImportPage = lazyScreen(() => import("./pages/FbrPurchaseImportPage"));
const GdCostingImportPage = lazyScreen(() => import("./pages/GdCostingImportPage"));
const ImportConsignmentsPage = lazyScreen(() => import("./pages/ImportConsignmentsPage"));
const ImportTaxDeskPage = lazyScreen(() => import("./pages/ImportTaxDeskPage"));
const ImportLcsPage = lazyScreen(() => import("./pages/ImportLcsPage"));
const ImportGuidePage = lazyScreen(() => import("./pages/ImportGuidePage"));
const SalesReportPage = lazyScreen(() => import("./pages/SalesReportPage"));
const InvoiceSalesDetailPage = lazyScreen(() => import("./pages/InvoiceSalesDetailPage"));
const TaxSheetPage = lazyScreen(() => import("./pages/TaxSheetPage"));
const ClientLedgerReportPage = lazyScreen(() => import("./pages/ClientLedgerReportPage"));
const ClientsPage = lazyScreen(() => import("./pages/ClientsPage"));
const SuppliersPage = lazyScreen(() => import("./pages/SuppliersPage"));
const ItemTypesPage = lazyScreen(() => import("./pages/ItemTypesPage"));
const NonInventoryItemsPage = lazyScreen(() => import("./pages/NonInventoryItemsPage"));
const UnitsPage = lazyScreen(() => import("./pages/UnitsPage"));
const POFormatsPage = lazyScreen(() => import("./pages/POFormatsPage"));
const ProfilePage = lazyScreen(() => import("./pages/ProfilePage"));
const UsersPage = lazyScreen(() => import("./pages/UsersPage"));
const RolesPage = lazyScreen(() => import("./pages/RolesPage"));
const TenantAccessPage = lazyScreen(() => import("./pages/TenantAccessPage"));
const AdministratorsPage = lazyScreen(() => import("./pages/AdministratorsPage"));
const TemplateEditorPage = lazyScreen(() => import("./pages/TemplateEditorPage"));
const PrintTemplatesPage = lazyScreen(() => import("./pages/PrintTemplatesPage"));
const CustomerPortalsPage = lazyScreen(() => import("./pages/CustomerPortalsPage"));
const AuditLogsPage = lazyScreen(() => import("./pages/AuditLogsPage"));
const FbrSettingsPage = lazyScreen(() => import("./pages/FbrSettingsPage"));
const FbrSandboxPage = lazyScreen(() => import("./pages/FbrSandboxPage"));
const FbrMonitorPage = lazyScreen(() => import("./pages/FbrMonitorPage"));
const NavigationMenuPage = lazyScreen(() => import("./pages/NavigationMenuPage"));
const WithholdingTaxReceiptsPage = lazyScreen(() => import("./pages/WithholdingTaxReceiptsPage"));

// Lazy so Recharts (used only by these two pages) stays out of the main chunk.
const DashboardPage = lazyScreen(() => import("./pages/DashboardPage"));
const AccountingDashboardPage = lazyScreen(() => import("./pages/AccountingDashboardPage"));
// The AI-connection consent screen is reached only from an AI app's sign-in hand-off.
const McpConnectPage = lazyScreen(() => import("./pages/McpConnectPage"));

const pageFallback = (
  <div className="d-flex justify-content-center align-items-center vh-100">
    <div className="spinner-border text-primary" role="status"><span className="visually-hidden">Loading...</span></div>
  </div>
);

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
    {/* How to connect an AI assistant over MCP. Explains the product only, no company data. */}
    <Route path="/mcp-guide" element={<McpGuidePage />} />

    {/* Protected app routes – auth guard + DashboardLayout */}
    <Route element={<ProtectedRoute />}>
      <Route element={<DashboardLayout />}>
        <Route path="/dashboard" element={<Suspense fallback={pageFallback}><DashboardPage /></Suspense>} />
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
        {/* One Invoices screen (2026-10-28): create, edit, print and FBR
            filing. The old Bills tab's URL redirects here with its query
            string, so bookmarks and stored return paths keep working.
            Distinct keys force a fresh mount between this and the note
            screens so filter state doesn't leak between them. */}
        <Route path="/bills" element={<BillsRedirect />} />
        <Route path="/invoices" element={<RequirePermission anyPrefix={["bills.", "invoices."]}><InvoicePage key="invoices" mode="invoices" /></RequirePermission>} />
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
        {/* Customer Ledger — read-only, derived live from invoices, notes and
            receipts. Its own catalog module (customerledger.*), sitting next
            to the Receipts/Payments it reports on. */}
        <Route path="/customer-ledger" element={<RequirePermission anyPrefix="customerledger."><CustomerLedgerPage /></RequirePermission>} />
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
        <Route path="/accounting/dashboard" element={<RequirePermission anyPrefix="accounting.dashboard"><Suspense fallback={pageFallback}><AccountingDashboardPage /></Suspense></RequirePermission>} />
        {/* Accounting reports: the bare path is the categorised index, and
            /:reportId opens one report. A separate route rather than an
            optional param — react-router v7 dropped optional-param syntax. */}
        <Route path="/accounting/reports" element={<RequirePermission anyPrefix="accounting.reports"><AccountingReportsPage /></RequirePermission>} />
        <Route path="/accounting/reports/:reportId" element={<RequirePermission anyPrefix="accounting.reports"><AccountingReportsPage /></RequirePermission>} />
        <Route path="/accounting/data-migration" element={<RequirePermission anyPrefix="accounting.import"><DataMigrationPage /></RequirePermission>} />
        <Route path="/accounting/manager-import" element={<RequirePermission anyPrefix="accounting.import"><ManagerImportPage /></RequirePermission>} />
        <Route path="/accounting/spreadsheet-import" element={<RequirePermission anyPrefix="spreadsheetimport."><SpreadsheetImportPage /></RequirePermission>} />
        <Route path="/purchase-bills" element={<RequirePermission anyPrefix="purchasebills."><PurchaseBillsPage /></RequirePermission>} />
        <Route path="/purchase-debit-notes" element={<RequirePermission anyPrefix="purchasedebitnotes."><PurchaseDebitNotesPage /></RequirePermission>} />
        <Route path="/goods-receipts" element={<RequirePermission anyPrefix="goodsreceipts."><GoodsReceiptsPage /></RequirePermission>} />
        <Route path="/stock" element={<RequirePermission anyPrefix="stock."><StockDashboardPage /></RequirePermission>} />
        <Route path="/stock/reconcile" element={<RequirePermission permission="stock.policy.manage"><StockReconcilePage /></RequirePermission>} />
        <Route path="/stock/split" element={<RequirePermission permission="stock.policy.manage"><StockSplitPage /></RequirePermission>} />
        {/* FBR Annexure-A purchase ledger import — Phase 1 preview only */}
        <Route path="/fbr-import/purchase" element={<RequirePermission anyPrefix="fbrimport."><FbrPurchaseImportPage /></RequirePermission>} />
        {/* GD costing workbook import — loads actual landed cost onto stock
            already on the books. Exact permission (not anyPrefix): the
            ImportCosting module also carries importcosting.consignments.view
            for the read-only Consignments screen below, which must not
            itself open this run/write page. */}
        <Route path="/imports/costing" element={<RequirePermission permission="importcosting.sheet.run"><GdCostingImportPage /></RequirePermission>} />
        {/* Task 21: view what a GD costing import wrote, and delete a
            consignment (the correction path) — separate permission from the
            run/write page above. */}
        <Route path="/imports/consignments" element={<RequirePermission permission="importcosting.consignments.view"><ImportConsignmentsPage /></RequirePermission>} />
        <Route path="/imports/tax-desk" element={<RequirePermission permission="importcosting.taxdesk.view"><ImportTaxDeskPage /></RequirePermission>} />
        <Route path="/imports/lcs" element={<RequirePermission permission="importcosting.lc.view"><ImportLcsPage /></RequirePermission>} />
        {/* Reports */}
        <Route path="/reports/sales" element={<RequirePermission anyPrefix="reports.sales"><SalesReportPage /></RequirePermission>} />
        <Route path="/reports/invoice-sales-detail" element={<RequirePermission permission="reports.invoicedetail.view"><InvoiceSalesDetailPage /></RequirePermission>} />
        <Route path="/reports/tax-sheet" element={<RequirePermission anyPrefix="reports.taxsheet"><TaxSheetPage /></RequirePermission>} />
        {/* Client Ledger — company-wide customer statements for a period,
            composed from the same customer-ledger service the Accounting
            screen uses. Its own Reports-module keys (reports.clientledger.*). */}
        <Route path="/reports/client-ledger" element={<RequirePermission anyPrefix="reports.clientledger"><ClientLedgerReportPage /></RequirePermission>} />
        <Route path="/profile" element={<ProfilePage />} />
        {/* "Sign in to connect" consent screen for AI applications (/oauth/authorize
            redirects to /admin/connect). Every signed-in user may open it: it says so
            itself when their MCP access is off, and the API decides what is granted. */}
        <Route path="/connect" element={<Suspense fallback={pageFallback}><McpConnectPage /></Suspense>} />
        <Route path="/users" element={<RequirePermission anyPrefix="users."><UsersPage /></RequirePermission>} />
        <Route path="/roles" element={<RequirePermission anyPrefix="rbac."><RolesPage /></RequirePermission>} />
        <Route path="/tenant-access" element={<RequirePermission anyPrefix={["tenantaccess.", "divisionaccess."]}><TenantAccessPage /></RequirePermission>} />
        <Route path="/administrators" element={<RequirePermission anyPrefix="users.manage."><AdministratorsPage /></RequirePermission>} />
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
        {/* Import costing guide — explains the product, exposes no company
            data, so it needs no permission. Same reasoning as /help/accounting. */}
        <Route path="/guides/import" element={<ImportGuidePage />} />
      </Route>
    </Route>

    {/* Catch-all */}
    <Route path="*" element={<h2 style={{ padding: "2rem" }}>Page Not Found</h2>} />
  </>
);

let routeTable = null;

// Ask every lazy screen inside a route's element to fetch its code. Elements
// are walked because a screen sits inside RequirePermission / Suspense here.
function preloadIn(element) {
  if (!isValidElement(element)) return;
  element.type?.preload?.();
  Children.forEach(element.props?.children, preloadIn);
}

// Start fetching the code of the screen at `pathname` (router-relative, no
// /admin). Only the code: the screen still renders behind ProtectedRoute and
// RequirePermission exactly as before, and a path that matches no screen does
// nothing.
// eslint-disable-next-line react-refresh/only-export-components
export function preloadScreenFor(pathname) {
  routeTable ??= createRoutesFromElements(appRoutes);
  for (const match of matchRoutes(routeTable, pathname) || []) preloadIn(match.route.element);
}

export default function App() {
  return <Routes>{appRoutes}</Routes>;
}

// /bills was the Bills tab; it is part of /invoices now. Keep ?search= and
// friends so a stored deep link still lands on its row.
function BillsRedirect() {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: "/invoices", search, hash }} replace />;
}
