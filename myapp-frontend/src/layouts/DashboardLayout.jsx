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
  MdStraighten,
  MdFileUpload,
  MdAdminPanelSettings,
  MdHistory,
  MdLocalShipping,
  MdShoppingCart,
  MdInventory,
  MdInventory2,
  MdLock,
  MdPointOfSale,
  MdAddShoppingCart,
} from "react-icons/md";
import { useAuth } from "../contexts/AuthContext";
import { Can, usePermissions } from "../contexts/PermissionsContext";
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
  const { user, logout } = useAuth();
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
  const configKeys = [
    "companies.manage.view",
    "clients.manage.view",
    "suppliers.manage.view",
    "itemtypes.manage.view",
    "config.units.manage",
    "poformats.manage.view",
    "printtemplates.manage.update",
    "fbr.config.update",
    "fbr.sandbox.view",
  ];
  const salesKeys = [
    "invoices.list.view",
    "itemratehistory.view",
    "challans.list.view",
    "challans.import.create",
  ];
  const purchasesKeys = [
    "purchasebills.list.view",
    "goodsreceipts.list.view",
    "stock.dashboard.view",
  ];
  const adminKeys = [
    "users.manage.view",
    "rbac.roles.view",
    "tenantaccess.manage.view",
    "auditlogs.view",
  ];
  const canSeeConfiguration = hasAny(configKeys);
  const canSeeSales         = hasAny(salesKeys);
  const canSeePurchases     = hasAny(purchasesKeys);
  const canSeeAdmin         = hasAny(adminKeys);

  // Per-group counts (visible-child count for the section's "[N]" badge).
  // Computed from the same permission keys the section gating uses, so
  // the badge always matches what the user can actually see beneath it.
  const salesCount         = salesKeys.filter(has).length;
  const purchasesCount     = purchasesKeys.filter(has).length;
  const configurationCount = configKeys.filter(has).length;
  const administrationCount = adminKeys.filter(has).length;

  // Active-section detection. Each module is "active" when the current
  // pathname falls inside one of its routes — used to auto-expand the
  // matching NavGroup on navigation. Memoised by pathname to avoid
  // recomputing on every render.
  const activeSection = useMemo(() => {
    const p = location.pathname.toLowerCase();
    if (p.startsWith("/challans") || p === "/bills" || p === "/invoices" || p === "/item-rate-history") return "sales";
    if (p.startsWith("/purchase-bills") || p.startsWith("/goods-receipts") || p.startsWith("/stock")) return "purchases";
    if (p.startsWith("/companies") || p.startsWith("/clients") || p.startsWith("/suppliers")
      || p.startsWith("/item-types") || p.startsWith("/units") || p.startsWith("/po-formats")
      || p.startsWith("/templates") || p.startsWith("/fbr-settings") || p.startsWith("/fbr-sandbox")) return "configuration";
    if (p.startsWith("/users") || p.startsWith("/roles") || p.startsWith("/tenant-access") || p.startsWith("/audit-logs")) return "administration";
    return "main";
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
  const avatarUrl = user?.avatarPath
    ? `${window.location.origin}${user.avatarPath}`
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
          {/* MAIN — Dashboard is always visible, no group header to keep
              the most-used route one tap away. */}
          <span className="dl-nav__section-label">Main</span>
          <NavLink
            to="/dashboard"
            className={({ isActive }) => "dl-item" + (isActive ? " dl-item--active" : "")}
          >
            <MdDashboard className="dl-item__icon" aria-hidden="true" />
            <span className="dl-item__label">Dashboard</span>
          </NavLink>

          {canSeeSales && (
            <NavGroup
              id="sales"
              icon={MdPointOfSale}
              title="Sales"
              count={salesCount}
              defaultOpen={activeSection === "sales"}
              isChildActive={activeSection === "sales"}
            >
              <Can permission="challans.import.create">
                <NavLink to="/challans/import" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdFileUpload className="dl-subitem__icon" aria-hidden="true" />
                  <span>Import Challans</span>
                </NavLink>
              </Can>
              <Can permission="challans.list.view">
                <NavLink to="/challans" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdDescription className="dl-subitem__icon" aria-hidden="true" />
                  <span>Delivery Challans</span>
                </NavLink>
              </Can>
              {/* Sales tab is split: Bills = pre-FBR data entry (no item-type
                  column, no Validate All / Submit All); Invoices = FBR
                  classification + submission. Both behind invoices.list.view —
                  the same dataset, two views. */}
              <Can permission="invoices.list.view">
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
              <Can permission="stock.dashboard.view">
                <NavLink to="/stock" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdInventory className="dl-subitem__icon" aria-hidden="true" />
                  <span>Stock Dashboard</span>
                </NavLink>
              </Can>
            </NavGroup>
          )}

          {canSeeConfiguration && (
            <NavGroup
              id="configuration"
              icon={MdSettings}
              title="Configuration"
              count={configurationCount}
              defaultOpen={activeSection === "configuration"}
              isChildActive={activeSection === "configuration"}
            >
              <Can permission="companies.manage.view">
                <NavLink to="/companies/list" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdBusiness className="dl-subitem__icon" aria-hidden="true" />
                  <span>Companies</span>
                </NavLink>
              </Can>
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
              <Can permission="config.units.manage">
                <NavLink to="/units" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdStraighten className="dl-subitem__icon" aria-hidden="true" />
                  <span>Units</span>
                </NavLink>
              </Can>
              <Can permission="poformats.manage.view">
                <NavLink to="/po-formats" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdDescription className="dl-subitem__icon" aria-hidden="true" />
                  <span>PO Formats</span>
                </NavLink>
              </Can>
              <Can permission="printtemplates.manage.update">
                <NavLink to="/templates" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
                  <MdCode className="dl-subitem__icon" aria-hidden="true" />
                  <span>Print Templates</span>
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
    "/item-types": "Configuration / Item Types",
    "/challans": "Challans",
    "/challans/import": "Challans / Import Historical",
    "/invoices": "Bills",
    "/item-rate-history": "Item Rate History",
    "/profile": "My Profile",
    "/users": "User Management",
    "/roles": "Roles & Permissions",
    "/templates": "Configuration / Print Templates",
    "/po-formats": "Configuration / PO Formats",
    "/units": "Configuration / Units",
    "/fbr-settings": "Configuration / FBR Settings",
    "/fbr-sandbox": "Configuration / FBR Sandbox",
    "/tenant-access": "Administration / Tenant Access",
    "/audit-logs": "Administration / Audit Logs",
  };
  return map[pathname] ?? pathname.replace(/\//g, " / ").replace(/^\s\/\s/, "");
}
