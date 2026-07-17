// src/layouts/DashboardLayout.jsx
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  MdDashboard,
  MdSettings,
  MdBusiness,
  MdPeople,
  MdCategory,
  MdDescription,
  MdReceipt,
  MdLogout,
  MdMenu,
  MdClose,
  MdKeyboardArrowDown,
  MdAccountCircle,
  MdGroupAdd,
  MdCode,
  MdBugReport,
  MdTune,
  MdScience,
  MdMonitorHeart,
  MdStraighten,
  MdFolder,
  MdFileUpload,
  MdAdminPanelSettings,
  MdHistory,
  MdRequestQuote,
  MdAssignment,
  MdUndo,
  MdLocalShipping,
  MdShoppingCart,
  MdInventory,
  MdInventory2,
  MdLock,
  MdPointOfSale,
  MdAddShoppingCart,
  MdAccountTree,
  MdAccountBalanceWallet,
  MdAccountBalance,
  MdReceiptLong,
  MdPayments,
  MdCloudDownload,
  MdSwapHoriz,
  MdMenuBook,
  MdInsights,
  MdAssessment,
  MdFactCheck,
} from "react-icons/md";
import { useAuth } from "../contexts/AuthContext";
import { Can, usePermissions } from "../contexts/PermissionsContext";
import { getAvatarUrl } from "../utils/avatarUrl";
import "./DashboardLayout.css";

/* ------------------------------------------------------------------ */
/*  NavGroup — generic collapsible section header                       */
/*                                                                     */
/*  Renders a button-as-header with a chevron, a count of visible       */
/*  children, and an animated body that toggles via max-height. The     */
/*  user's open/closed preference per section is persisted to           */
/*  localStorage so the layout remembers across reloads. The parent     */
/*  passes `defaultOpen` for the initial state — typically true when    */
/*  the current route lives inside this section, false otherwise.       */
/* ------------------------------------------------------------------ */
function NavGroup({ id, icon: Icon, title, defaultOpen, count, isChildActive, children }) {
  const storageKey = `erp.nav.${id}`;
  const [open, setOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored === "0") return false;
      if (stored === "1") return true;
    } catch { /* localStorage may be unavailable */ }
    return defaultOpen;
  });

  // When a child route becomes active, force the section open. We don't
  // override an explicit user collapse on subsequent navigations — only
  // when isChildActive flips from false→true do we re-expand.
  const lastChildActive = useRef(isChildActive);
  useEffect(() => {
    if (isChildActive && !lastChildActive.current) {
      setOpen(true);
    }
    lastChildActive.current = isChildActive;
  }, [isChildActive]);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem(storageKey, next ? "1" : "0"); } catch { /* noop */ }
      return next;
    });
  }, [storageKey]);

  if (count === 0) return null;

  return (
    <div className={`dl-group${open ? " dl-group--open" : ""}${isChildActive ? " dl-group--child-active" : ""}`}>
      <button
        type="button"
        className="dl-group__header"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={`dl-group-${id}`}
      >
        {Icon && <Icon className="dl-group__icon" aria-hidden="true" />}
        <span className="dl-group__title">{title}</span>
        {count > 0 && <span className="dl-group__count">{count}</span>}
        <MdKeyboardArrowDown className="dl-group__chevron" aria-hidden="true" />
      </button>
      <div
        id={`dl-group-${id}`}
        className="dl-group__body"
        role="region"
        aria-label={`${title} submenu`}
      >
        <div className="dl-group__body-inner">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helper: derive user initials from user object                       */
/* ------------------------------------------------------------------ */
function getInitials(user) {
  if (!user) return "?";
  const name = user.name ?? user.username ?? user.email ?? "";
  return name
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .slice(0, 2)
    .join("");
}

function getDisplayName(user) {
  if (!user) return "Guest";
  return user.name ?? user.username ?? user.email ?? "User";
}

/* ------------------------------------------------------------------ */
/*  DashboardLayout                                                     */
/* ------------------------------------------------------------------ */
export default function DashboardLayout() {
  const { user, logout, avatarVersion } = useAuth();
  const { hasAny, has } = usePermissions();
  const location = useLocation();
  const navigate = useNavigate();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);

  // Each section's keys — used both to gate the section *header* and to
  // open the Configuration submenu. A user with zero matching perms gets
  // neither the divider nor the label, so the sidebar doesn't show empty
  // section stubs (which look broken when MANAGEMENT / SALES / PURCHASES
  // / ADMINISTRATION render with nothing under them).
  // Dashboards — the three overview pages unified under one nav group.
  const dashboardsKeys = [
    "dashboard.view",
    "stock.dashboard.view",
    "accounting.dashboard.view",
  ];
  // Master Data — the contact + catalog lookups (was mixed into Configuration).
  const masterDataKeys = [
    "clients.manage.view",
    "suppliers.manage.view",
    "itemtypes.manage.view",
    "noninventoryitems.list.view",
    "config.units.manage",
  ];
  // Settings — company/system configuration + FBR tooling.
  const settingsKeys = [
    "companies.manage.view",
    "divisions.manage.view",
    "poformats.manage.view",
    "printtemplates.manage.update",
    "fbr.config.update",
    "fbr.sandbox.view",
    "fbrmonitor.view",
    "folders.list.view",
  ];
  const salesKeys = [
    // Sales tab visible if the user has any of: sales quotes, sales orders,
    // see-bills (Bills + Invoices tabs), see-challans, import-challans,
    // item-rate-history.
    "salesquotes.list.view",
    "salesorders.list.view",
    "bills.list.view",
    "invoices.list.view",
    "withholdingtax.list.view",
    "itemratehistory.view",
    "challans.list.view",
    "challans.import.create",
  ];
  const purchasesKeys = [
    "purchasebills.list.view",
    "goodsreceipts.list.view",
    "fbrimport.purchase.preview",
  ];
  const accountingKeys = [
    "accounting.receipts.view",
    "accounting.payments.view",
    "accounting.transfers.view",
    "accounting.journal.view",
    "accounting.coa.view",
  ];
  const reportsKeys = [
    "reports.sales.view",
    "reports.taxsheet.view",
    "accounting.reports.view",
  ];
  const adminKeys = [
    "users.manage.view",
    "rbac.roles.view",
    "tenantaccess.manage.view",
    "auditlogs.view",
    "accounting.import.run",
    "accounting.import.manager",
  ];
  const canSeeDashboards    = hasAny(dashboardsKeys);
  const canSeeMasterData    = hasAny(masterDataKeys);
  const canSeeSettings      = hasAny(settingsKeys);
  const canSeeSales         = hasAny(salesKeys);
  const canSeePurchases     = hasAny(purchasesKeys);
  const canSeeAccounting    = hasAny(accountingKeys);
  const canSeeReports       = hasAny(reportsKeys);
  const canSeeAdmin         = hasAny(adminKeys);

  // Per-group counts (visible-child count for the section's "[N]" badge).
  // Computed from the same permission keys the section gating uses, so
  // the badge always matches what the user can actually see beneath it.
  const dashboardsCount    = dashboardsKeys.filter(has).length;
  const salesCount         = salesKeys.filter(has).length;
  const purchasesCount     = purchasesKeys.filter(has).length;
  const accountingCount    = accountingKeys.filter(has).length;
  const reportsCount       = reportsKeys.filter(has).length;
  const masterDataCount    = masterDataKeys.filter(has).length;
  const settingsCount      = settingsKeys.filter(has).length;
  const administrationCount = adminKeys.filter(has).length;

  // Active-section detection. Each module is "active" when the current
  // pathname falls inside one of its routes — used to auto-expand the
  // matching NavGroup on navigation. Memoised by pathname to avoid
  // recomputing on every render.
  const activeSection = useMemo(() => {
    const p = location.pathname.toLowerCase();
    // The three unified dashboards. Checked first so /accounting/dashboard
    // opens Dashboards, not Accounting.
    if (p === "/dashboard" || p.startsWith("/stock") || p.startsWith("/accounting/dashboard")) return "dashboards";
    // Reports — incl. the accounting reports moved here from Accounting.
    if (p.startsWith("/reports") || p.startsWith("/accounting/reports")) return "reports";
    // Data-import/migration ops live under Administration.
    if (p.startsWith("/users") || p.startsWith("/roles") || p.startsWith("/tenant-access") || p.startsWith("/audit-logs")
      || p.startsWith("/accounting/data-migration") || p.startsWith("/accounting/manager-import")) return "administration";
    if (p.startsWith("/challans") || p.startsWith("/sales-quotes") || p.startsWith("/sales-orders") || p.startsWith("/withholding-tax") || p === "/bills" || p === "/invoices" || p === "/credit-notes" || p === "/debit-notes" || p === "/credit-debit-notes" || p === "/item-rate-history") return "sales";
    if (p.startsWith("/purchase-bills") || p.startsWith("/goods-receipts") || p.startsWith("/fbr-import/purchase")) return "purchases";
    if (p.startsWith("/receipts") || p.startsWith("/payments") || p.startsWith("/chart-of-accounts") || p.startsWith("/bank-cash-accounts") || p.startsWith("/transfers") || p.startsWith("/journal-entries") || p.startsWith("/accounting/")) return "accounting";
    if (p.startsWith("/clients") || p.startsWith("/suppliers") || p.startsWith("/item-types") || p.startsWith("/non-inventory-items") || p.startsWith("/units")) return "masterdata";
    if (p.startsWith("/companies") || p.startsWith("/configuration/") || p.startsWith("/divisions") || p.startsWith("/po-formats")
      || p.startsWith("/templates") || p.startsWith("/fbr-settings") || p.startsWith("/fbr-sandbox") || p.startsWith("/fbr-monitor")) return "settings";
    return "dashboards";
  }, [location.pathname]);

  // Close sidebar on navigation (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  // Body scroll-lock when the mobile drawer is open. Without this the
  // page underneath scrolls behind the drawer on iOS, which feels broken.
  useEffect(() => {
    if (sidebarOpen) {
      document.body.classList.add("dl-body--locked");
    } else {
      document.body.classList.remove("dl-body--locked");
    }
    return () => document.body.classList.remove("dl-body--locked");
  }, [sidebarOpen]);

  // Close user menu on click outside
  useEffect(() => {
    const handler = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  const displayName = getDisplayName(user);
  const initials = getInitials(user);
  const avatarRelative = getAvatarUrl(user, avatarVersion);
  const avatarUrl = avatarRelative
    ? `${window.location.origin}${avatarRelative}`
    : null;

  return (
    <div className="dl-shell">
      {/* ---- Mobile Overlay ---- */}
      <div
        className={`dl-overlay${sidebarOpen ? " dl-overlay--visible" : ""}`}
        onClick={closeSidebar}
        aria-hidden="true"
      />

      {/* ================================================================ */}
      {/*  SIDEBAR                                                         */}
      {/* ================================================================ */}
      <aside className={`dl-sidebar${sidebarOpen ? " dl-sidebar--open" : ""}`} aria-label="Main navigation">
        {/* Brand row — clean, single-line on mobile, with a close button
            inside the drawer so users don't have to reach for the topbar. */}
        <div className="dl-brand">
          <div className="dl-brand__row">
            <span className="dl-brand__icon" aria-hidden="true">📄</span>
            <h1 className="dl-brand__name">FBR Digital ERP</h1>
            <button
              type="button"
              className="dl-brand__close"
              onClick={closeSidebar}
              aria-label="Close menu"
            >
              <MdClose aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Nav */}
        <nav className="dl-nav" role="navigation">
          {/* DASHBOARDS — the three overview pages (Overview / Inventory /
              Accounting) unified under one group so there's a single place
              for "dashboards" across the app. */}
          {canSeeDashboards && (
            <NavGroup
              id="dashboards"
              icon={MdDashboard}
              title="Dashboards"
              count={dashboardsCount}
              defaultOpen={activeSection === "dashboards"}
              isChildActive={activeSection === "dashboards"}
            >
              <Can permission="dashboard.view">
                <NavLink to="/dashboard" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdDashboard className="dl-subitem__icon" aria-hidden="true" />
                  <span>Overview</span>
                </NavLink>
              </Can>
              <Can permission="stock.dashboard.view">
                <NavLink to="/stock" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdInventory className="dl-subitem__icon" aria-hidden="true" />
                  <span>Inventory</span>
                </NavLink>
              </Can>
              <Can permission="accounting.dashboard.view">
                <NavLink to="/accounting/dashboard" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdInsights className="dl-subitem__icon" aria-hidden="true" />
                  <span>Accounting</span>
                </NavLink>
              </Can>
            </NavGroup>
          )}

          {canSeeSales && (
            <NavGroup
              id="sales"
              icon={MdPointOfSale}
              title="Sales"
              count={salesCount}
              defaultOpen={activeSection === "sales"}
              isChildActive={activeSection === "sales"}
            >
              <Can permission="salesquotes.list.view">
                <NavLink to="/sales-quotes" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdRequestQuote className="dl-subitem__icon" aria-hidden="true" />
                  <span>Sales Quotes</span>
                </NavLink>
              </Can>
              <Can permission="salesorders.list.view">
                <NavLink to="/sales-orders" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdAssignment className="dl-subitem__icon" aria-hidden="true" />
                  <span>Sales Orders</span>
                </NavLink>
              </Can>
              <Can permission="challans.import.create">
                <NavLink to="/challans/import" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdFileUpload className="dl-subitem__icon" aria-hidden="true" />
                  <span>Import Challans</span>
                </NavLink>
              </Can>
              <Can permission="challans.list.view">
                {/* `end`: /challans is a prefix of /challans/import, so without
                    it this link stays active on the Import Challans route and
                    both items light up. */}
                <NavLink to="/challans" end className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdDescription className="dl-subitem__icon" aria-hidden="true" />
                  <span>Delivery Challans</span>
                </NavLink>
              </Can>
              {/* Sales tab is split: Bills = data entry (gated by
                  bills.list.view); Invoices = FBR classification + submission
                  (gated by invoices.list.view). Same underlying dataset, two
                  views with their own permission namespaces — see catalog. */}
              <Can permission="bills.list.view">
                <NavLink to="/bills" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdReceipt className="dl-subitem__icon" aria-hidden="true" />
                  <span>Bills</span>
                </NavLink>
              </Can>
              <Can permission="invoices.list.view">
                <NavLink to="/invoices" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdReceipt className="dl-subitem__icon" aria-hidden="true" />
                  <span>Invoices</span>
                </NavLink>
              </Can>
              {/* Credit Notes (returns/reversals) and Debit Notes (upward
                  adjustments) — separate tabs, each with its own numbering
                  sequence, never mixed with Bills/Invoices. Gated by the
                  list-view perm; the "New" buttons on the pages are gated
                  by invoices.note.create. */}
              <Can permission="invoices.list.view">
                <NavLink to="/credit-notes" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdUndo className="dl-subitem__icon" aria-hidden="true" />
                  <span>Credit Notes</span>
                </NavLink>
              </Can>
              <Can permission="invoices.list.view">
                <NavLink to="/debit-notes" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdUndo className="dl-subitem__icon" aria-hidden="true" />
                  <span>Debit Notes</span>
                </NavLink>
              </Can>
              <Can permission="withholdingtax.list.view">
                <NavLink to="/withholding-tax" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdFactCheck className="dl-subitem__icon" aria-hidden="true" />
                  <span>Withholding Tax</span>
                </NavLink>
              </Can>
              <Can permission="itemratehistory.view">
                <NavLink to="/item-rate-history" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdHistory className="dl-subitem__icon" aria-hidden="true" />
                  <span>Item Rate History</span>
                </NavLink>
              </Can>
            </NavGroup>
          )}

          {canSeePurchases && (
            <NavGroup
              id="purchases"
              icon={MdAddShoppingCart}
              title="Purchases"
              count={purchasesCount}
              defaultOpen={activeSection === "purchases"}
              isChildActive={activeSection === "purchases"}
            >
              <Can permission="purchasebills.list.view">
                <NavLink to="/purchase-bills" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdShoppingCart className="dl-subitem__icon" aria-hidden="true" />
                  <span>Purchase Bills</span>
                </NavLink>
              </Can>
              <Can permission="goodsreceipts.list.view">
                <NavLink to="/goods-receipts" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdInventory2 className="dl-subitem__icon" aria-hidden="true" />
                  <span>Goods Receipts</span>
                </NavLink>
              </Can>
              <Can permission="fbrimport.purchase.preview">
                <NavLink to="/fbr-import/purchase" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdFileUpload className="dl-subitem__icon" aria-hidden="true" />
                  <span>FBR Purchase Import</span>
                </NavLink>
              </Can>
            </NavGroup>
          )}

          {canSeeAccounting && (
            <NavGroup
              id="accounting"
              icon={MdAccountBalanceWallet}
              title="Accounting"
              count={accountingCount}
              defaultOpen={activeSection === "accounting"}
              isChildActive={activeSection === "accounting"}
            >
              <Can permission="accounting.coa.view">
                <NavLink to="/bank-cash-accounts" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdAccountBalance className="dl-subitem__icon" aria-hidden="true" />
                  <span>Bank &amp; Cash Accounts</span>
                </NavLink>
              </Can>
              <Can permission="accounting.receipts.view">
                <NavLink to="/receipts" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdReceiptLong className="dl-subitem__icon" aria-hidden="true" />
                  <span>Receipts</span>
                </NavLink>
              </Can>
              <Can permission="accounting.payments.view">
                <NavLink to="/payments" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdPayments className="dl-subitem__icon" aria-hidden="true" />
                  <span>Payments</span>
                </NavLink>
              </Can>
              <Can permission="accounting.transfers.view">
                <NavLink to="/transfers" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdSwapHoriz className="dl-subitem__icon" aria-hidden="true" />
                  <span>Transfers</span>
                </NavLink>
              </Can>
              <Can permission="accounting.journal.view">
                <NavLink to="/journal-entries" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdMenuBook className="dl-subitem__icon" aria-hidden="true" />
                  <span>Journal Entries</span>
                </NavLink>
              </Can>
              <Can permission="accounting.coa.view">
                <NavLink to="/chart-of-accounts" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdAccountTree className="dl-subitem__icon" aria-hidden="true" />
                  <span>Chart of Accounts</span>
                </NavLink>
              </Can>
            </NavGroup>
          )}

          {canSeeReports && (
            <NavGroup
              id="reports"
              icon={MdAssessment}
              title="Reports"
              count={reportsCount}
              defaultOpen={activeSection === "reports"}
              isChildActive={activeSection === "reports"}
            >
              <Can permission="reports.sales.view">
                <NavLink to="/reports/sales" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdAssessment className="dl-subitem__icon" aria-hidden="true" />
                  <span>Sales Report</span>
                </NavLink>
              </Can>
              <Can permission="reports.taxsheet.view">
                <NavLink to="/reports/tax-sheet" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdFactCheck className="dl-subitem__icon" aria-hidden="true" />
                  <span>Tax Sheet</span>
                </NavLink>
              </Can>
              {/* Accounting reports (trial balance / AR-AP aging) live here with
                  the other reports, not under the Accounting module. */}
              <Can permission="accounting.reports.view">
                <NavLink to="/accounting/reports" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdAssessment className="dl-subitem__icon" aria-hidden="true" />
                  <span>Accounting Reports</span>
                </NavLink>
              </Can>
            </NavGroup>
          )}

          {canSeeMasterData && (
            <NavGroup
              id="masterdata"
              icon={MdCategory}
              title="Master Data"
              count={masterDataCount}
              defaultOpen={activeSection === "masterdata"}
              isChildActive={activeSection === "masterdata"}
            >
              <Can permission="clients.manage.view">
                <NavLink to="/Clients/list" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdPeople className="dl-subitem__icon" aria-hidden="true" />
                  <span>Clients</span>
                </NavLink>
              </Can>
              <Can permission="suppliers.manage.view">
                <NavLink to="/Suppliers/list" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdLocalShipping className="dl-subitem__icon" aria-hidden="true" />
                  <span>Suppliers</span>
                </NavLink>
              </Can>
              <Can permission="itemtypes.manage.view">
                <NavLink to="/item-types" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdCategory className="dl-subitem__icon" aria-hidden="true" />
                  <span>Item Types</span>
                </NavLink>
              </Can>
              <Can permission="noninventoryitems.list.view">
                <NavLink to="/non-inventory-items" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdRequestQuote className="dl-subitem__icon" aria-hidden="true" />
                  <span>Non-Inventory Items</span>
                </NavLink>
              </Can>
              <Can permission="config.units.manage">
                <NavLink to="/units" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdStraighten className="dl-subitem__icon" aria-hidden="true" />
                  <span>Units</span>
                </NavLink>
              </Can>
            </NavGroup>
          )}

          {canSeeSettings && (
            <NavGroup
              id="settings"
              icon={MdSettings}
              title="Settings"
              count={settingsCount}
              defaultOpen={activeSection === "settings"}
              isChildActive={activeSection === "settings"}
            >
              <Can permission="companies.manage.view">
                <NavLink to="/companies/list" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdBusiness className="dl-subitem__icon" aria-hidden="true" />
                  <span>Companies</span>
                </NavLink>
              </Can>
              <Can permission="divisions.manage.view">
                <NavLink to="/configuration/divisions" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdAccountTree className="dl-subitem__icon" aria-hidden="true" />
                  <span>Divisions</span>
                </NavLink>
              </Can>
              <Can permission="printtemplates.manage.update">
                <NavLink to="/templates" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdCode className="dl-subitem__icon" aria-hidden="true" />
                  <span>Print Templates</span>
                </NavLink>
              </Can>
              <Can permission="poformats.manage.view">
                <NavLink to="/po-formats" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdDescription className="dl-subitem__icon" aria-hidden="true" />
                  <span>PO Formats</span>
                </NavLink>
              </Can>
              <Can permission="fbr.config.update">
                <NavLink to="/fbr-settings" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdTune className="dl-subitem__icon" aria-hidden="true" />
                  <span>FBR Settings</span>
                </NavLink>
              </Can>
              <Can permission="fbr.sandbox.view">
                <NavLink to="/fbr-sandbox" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdScience className="dl-subitem__icon" aria-hidden="true" />
                  <span>FBR Sandbox</span>
                </NavLink>
              </Can>
              <Can permission="fbrmonitor.view">
                <NavLink to="/fbr-monitor" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdMonitorHeart className="dl-subitem__icon" aria-hidden="true" />
                  <span>FBR Monitor</span>
                </NavLink>
              </Can>
              <Can permission="folders.list.view">
                <NavLink to="/configuration/navigation-menu" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdFolder className="dl-subitem__icon" aria-hidden="true" />
                  <span>Navigation Menu</span>
                </NavLink>
              </Can>
            </NavGroup>
          )}

          {canSeeAdmin && (
            <NavGroup
              id="administration"
              icon={MdAdminPanelSettings}
              title="Administration"
              count={administrationCount}
              defaultOpen={activeSection === "administration"}
              isChildActive={activeSection === "administration"}
            >
              <Can permission="users.manage.view">
                <NavLink to="/users" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdGroupAdd className="dl-subitem__icon" aria-hidden="true" />
                  <span>Users</span>
                </NavLink>
              </Can>
              <Can permission="rbac.roles.view">
                <NavLink to="/roles" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdAdminPanelSettings className="dl-subitem__icon" aria-hidden="true" />
                  <span>Roles &amp; Permissions</span>
                </NavLink>
              </Can>
              <Can permission="tenantaccess.manage.view">
                <NavLink to="/tenant-access" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdLock className="dl-subitem__icon" aria-hidden="true" />
                  <span>Tenant Access</span>
                </NavLink>
              </Can>
              <Can permission="auditlogs.view">
                <NavLink to="/audit-logs" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdBugReport className="dl-subitem__icon" aria-hidden="true" />
                  <span>Audit Logs</span>
                </NavLink>
              </Can>
              {/* Whole-company data-import / migration ops — admin-grade tools,
                  moved out of the Accounting module. */}
              <Can permission="accounting.import.run">
                <NavLink to="/accounting/data-migration" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdCloudDownload className="dl-subitem__icon" aria-hidden="true" />
                  <span>Data Migration</span>
                </NavLink>
              </Can>
              <Can permission="accounting.import.manager">
                <NavLink to="/accounting/manager-import" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdCloudDownload className="dl-subitem__icon" aria-hidden="true" />
                  <span>Manager.io Import</span>
                </NavLink>
              </Can>
            </NavGroup>
          )}

        </nav>

        {/* Account & Footer – pinned to bottom, never scrolls. */}
        <div className="dl-sidebar-bottom">
          <NavLink
            to="/profile"
            className={({ isActive }) => "dl-item" + (isActive ? " dl-item--active" : "")}
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="dl-item__avatar" aria-hidden="true" />
            ) : (
              <MdAccountCircle className="dl-item__icon" aria-hidden="true" />
            )}
            <span className="dl-item__label">{displayName}</span>
          </NavLink>
          <button
            type="button"
            className="dl-logout-btn"
            onClick={logout}
            aria-label="Logout"
          >
            <MdLogout aria-hidden="true" />
            <span>Logout</span>
          </button>
          <p className="dl-sidebar-footer__copy">
            &copy; {new Date().getFullYear()} FBR Digital ERP
          </p>
        </div>
      </aside>

      {/* ================================================================ */}
      {/*  CONTENT WRAPPER                                                 */}
      {/* ================================================================ */}
      <div className="dl-content-wrapper">
        {/* Top Bar */}
        <header className="dl-topbar">
          <button
            type="button"
            className="dl-topbar__hamburger"
            onClick={() => setSidebarOpen((prev) => !prev)}
            aria-label={sidebarOpen ? "Close menu" : "Open menu"}
            aria-expanded={sidebarOpen}
          >
            {sidebarOpen ? <MdClose /> : <MdMenu />}
          </button>

          <div className="dl-topbar__breadcrumb" aria-label="Breadcrumb">
            {getBreadcrumb(location.pathname)}
          </div>

          <div className="dl-topbar__user-wrapper" ref={userMenuRef}>
            <button
              type="button"
              className="dl-topbar__user"
              onClick={() => setUserMenuOpen((prev) => !prev)}
              aria-expanded={userMenuOpen}
              aria-haspopup="true"
            >
              <div className="dl-topbar__avatar" aria-hidden="true">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" className="dl-topbar__avatar-img" />
                ) : (
                  initials
                )}
              </div>
              <span>{displayName}</span>
              <MdKeyboardArrowDown
                className={`dl-topbar__user-arrow${userMenuOpen ? " dl-topbar__user-arrow--open" : ""}`}
                aria-hidden="true"
              />
            </button>
            {userMenuOpen && (
              <div className="dl-user-menu">
                <button
                  type="button"
                  className="dl-user-menu__item"
                  onClick={() => { setUserMenuOpen(false); navigate("/profile"); }}
                >
                  <MdAccountCircle className="dl-user-menu__icon" />
                  My Profile
                </button>
                <hr className="dl-user-menu__divider" />
                <button
                  type="button"
                  className="dl-user-menu__item dl-user-menu__item--danger"
                  onClick={() => { setUserMenuOpen(false); logout(); }}
                >
                  <MdLogout className="dl-user-menu__icon" />
                  Logout
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Page Content */}
        <main className="dl-main" id="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Breadcrumb helper                                                   */
/* ------------------------------------------------------------------ */
function getBreadcrumb(pathname) {
  const map = {
    "/dashboard": "Dashboard",
    "/companies/list": "Configuration / Companies List",
    "/Clients/list": "Configuration / Clients List",
    "/Suppliers/list": "Configuration / Suppliers List",
    "/purchase-bills": "Purchases / Purchase Bills",
    "/goods-receipts": "Purchases / Goods Receipts",
    "/stock": "Purchases / Stock Dashboard",
    "/fbr-import/purchase": "Purchases / FBR Purchase Import",
    "/item-types": "Configuration / Item Types",
    "/non-inventory-items": "Configuration / Non-Inventory Items",
    "/challans": "Sales / Delivery Challans",
    "/challans/import": "Sales / Import Challans",
    "/bills": "Sales / Bills",
    "/invoices": "Sales / Invoices",
    "/credit-notes": "Sales / Credit Notes",
    "/debit-notes": "Sales / Debit Notes",
    "/withholding-tax": "Sales / Withholding Tax Receipts",
    "/credit-debit-notes": "Sales / New Credit / Debit Note",
    "/item-rate-history": "Sales / Item Rate History",
    "/profile": "My Profile",
    "/users": "User Management",
    "/roles": "Roles & Permissions",
    "/templates": "Configuration / Print Templates",
    "/templates/edit": "Configuration / Print Templates / Editor",
    "/po-formats": "Configuration / PO Formats",
    "/units": "Configuration / Units",
    "/fbr-settings": "Configuration / FBR Settings",
    "/fbr-sandbox": "Configuration / FBR Sandbox",
    "/fbr-monitor": "Configuration / FBR Monitor",
    "/tenant-access": "Administration / Tenant Access",
    "/audit-logs": "Administration / Audit Logs",
  };
  return map[pathname] ?? pathname.replace(/\//g, " / ").replace(/^\s\/\s/, "");
}
