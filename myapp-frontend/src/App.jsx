// App.jsx
import { Routes, Route, Navigate } from "react-router-dom";
import DashboardLayout from "./layouts/DashboardLayout";
import PublicLayout from "./layouts/PublicLayout";
import DashboardPage from "./pages/DashboardPage";
import CompanyPage from "./pages/CompanyPage";
import DivisionsPage from "./pages/DivisionsPage";
import ChallansPage from "./pages/ChallanPage";
import ImportChallansPage from "./pages/ImportChallansPage";
import SalesQuotePage from "./pages/SalesQuotePage";
import SalesOrderPage from "./pages/SalesOrderPage";
import InvoicePage from "./pages/InvoicePage";
import PaymentsPage from "./pages/PaymentsPage";
import CustomerLedgerPage from "./pages/CustomerLedgerPage";
import ChartOfAccountsPage from "./pages/ChartOfAccountsPage";
import BankCashAccountsPage from "./pages/BankCashAccountsPage";
import JournalEntriesPage from "./pages/JournalEntriesPage";
import TransfersPage from "./pages/TransfersPage";
import AccountingDashboardPage from "./pages/AccountingDashboardPage";
import AccountingReportsPage from "./pages/AccountingReportsPage";
import DataMigrationPage from "./pages/DataMigrationPage";
import ManagerImportPage from "./pages/ManagerImportPage";
import CreditDebitNotePage from "./pages/CreditDebitNotePage";
import ItemRateHistoryPage from "./pages/ItemRateHistoryPage";
import PurchaseBillsPage from "./pages/PurchaseBillsPage";
import PurchaseDebitNotesPage from "./pages/PurchaseDebitNotesPage";
import GoodsReceiptsPage from "./pages/GoodsReceiptsPage";
import StockDashboardPage from "./pages/StockDashboardPage";
import FbrPurchaseImportPage from "./pages/FbrPurchaseImportPage";
import SalesReportPage from "./pages/SalesReportPage";
import TaxSheetPage from "./pages/TaxSheetPage";
import ClientsPage from "./pages/ClientsPage";
import SuppliersPage from "./pages/SuppliersPage";
import ItemTypesPage from "./pages/ItemTypesPage";
import NonInventoryItemsPage from "./pages/NonInventoryItemsPage";
import UnitsPage from "./pages/UnitsPage";
import POFormatsPage from "./pages/POFormatsPage";
import ProfilePage from "./pages/ProfilePage";
import UsersPage from "./pages/UsersPage";
import RolesPage from "./pages/RolesPage";
import TenantAccessPage from "./pages/TenantAccessPage";
import TemplateEditorPage from "./pages/TemplateEditorPage";
import PrintTemplatesPage from "./pages/PrintTemplatesPage";
import CustomerPortalsPage from "./pages/CustomerPortalsPage";
import AuditLogsPage from "./pages/AuditLogsPage";
import FbrSettingsPage from "./pages/FbrSettingsPage";
import FbrSandboxPage from "./pages/FbrSandboxPage";
import FbrMonitorPage from "./pages/FbrMonitorPage";
import NavigationMenuPage from "./pages/NavigationMenuPage";
import WithholdingTaxReceiptsPage from "./pages/WithholdingTaxReceiptsPage";
import LoginPage from "./pages/public/LoginPage";
import LandingPage from "./pages/public/LandingPage";
import ProtectedRoute from "./Components/ProtectedRoute";
import RequirePermission from "./Components/RequirePermission";
import "./App.css";

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
          {/* Customer Ledger — read-only, derived live from invoices, notes and
              receipts. Its own catalog module (customerledger.*), sitting next
              to the Receipts/Payments it reports on. */}
          <Route path="/customer-ledger" element={<RequirePermission anyPrefix="customerledger."><CustomerLedgerPage /></RequirePermission>} />
          <Route path="/chart-of-accounts" element={<RequirePermission anyPrefix="accounting.coa"><ChartOfAccountsPage /></RequirePermission>} />
          <Route path="/bank-cash-accounts" element={<RequirePermission anyPrefix={["accounting.coa", "accounting.reconciliation"]}><BankCashAccountsPage /></RequirePermission>} />
          {/* General Ledger (Phase B): transfers move money between own
              bank/cash accounts; journal entries are manual GL postings;
              the accounting dashboard + reports read the live ledger. */}
          <Route path="/transfers" element={<RequirePermission anyPrefix="accounting.transfers"><TransfersPage /></RequirePermission>} />
          <Route path="/journal-entries" element={<RequirePermission anyPrefix="accounting.journal"><JournalEntriesPage /></RequirePermission>} />
          <Route path="/accounting/dashboard" element={<RequirePermission anyPrefix="accounting.dashboard"><AccountingDashboardPage /></RequirePermission>} />
          <Route path="/accounting/reports" element={<RequirePermission anyPrefix="accounting.reports"><AccountingReportsPage /></RequirePermission>} />
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
  );
}
