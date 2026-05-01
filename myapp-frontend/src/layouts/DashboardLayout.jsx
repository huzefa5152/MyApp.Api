// src/layouts/DashboardLayout.jsx
import { useState, useRef, useEffect, useCallback } from "react";
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
} from "react-icons/md";
import { useAuth } from "../contexts/AuthContext";
import { Can, usePermissions } from "../contexts/PermissionsContext";
import "./DashboardLayout.css";

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
  const { hasAny } = usePermissions();
  const location = useLocation();
  const navigate = useNavigate();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Default-expand the Configuration submenu — FBR Settings / FBR Sandbox /
  // Companies / Clients / Suppliers / Item Types etc. live inside it, and
  // hiding them behind a click hurts discoverability for new operators.
  const [configOpen, setConfigOpen] = useState(true);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);

  // Configuration menu is shown if the user can reach ANY of its children.
  const configKeys = [
    "companies.manage.view",
    "clients.manage.view",
    "suppliers.manage.view",
    "itemtypes.manage.view",
    "poformats.manage.view",
    "printtemplates.manage.update",
    "fbr.config.update",
    "fbr.sandbox.view",
  ];
  const canSeeConfiguration = hasAny(configKeys);

  // Auto-expand Configuration submenu if a child route is active
  const isConfigActive = location.pathname.startsWith("/companies") || location.pathname.startsWith("/Clients") || location.pathname.startsWith("/Suppliers") || location.pathname.startsWith("/item-types") || location.pathname.startsWith("/po-formats") || location.pathname.startsWith("/templates") || location.pathname.startsWith("/fbr-settings") || location.pathname.startsWith("/fbr-sandbox");
  useEffect(() => {
    if (isConfigActive) setConfigOpen(true);
  }, [isConfigActive]);

  // Close sidebar on navigation (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

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
  const toggleConfig = useCallback(() => setConfigOpen((prev) => !prev), []);

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
        {/* Brand */}
        <div className="dl-brand">
          <span className="dl-brand__icon" aria-hidden="true">📄</span>
          <h1 className="dl-brand__name">FBR Digital Invoicing ERP</h1>
          <p className="dl-brand__tagline">Sales Tax Compliance Portal</p>
        </div>

        {/* Nav */}
        <nav className="dl-nav" role="navigation">
          <span className="dl-nav__section-label">Main</span>

          {/* Dashboard */}
          <NavLink
            to="/dashboard"
            className={({ isActive }) =>
              "dl-nav__item" + (isActive ? " active" : "")
            }
          >
            <MdDashboard className="dl-nav__icon" aria-hidden="true" />
            <span className="dl-nav__label">Dashboard</span>
          </NavLink>

          <hr className="dl-nav__divider" />
          <span className="dl-nav__section-label">Management</span>

          {/* Configuration (expandable) — only if caller has access to at
              least one sub-item. */}
          {canSeeConfiguration && (
            <>
              <button
                type="button"
                className={`dl-nav__item${isConfigActive ? " dl-nav__item--active" : ""}`}
                onClick={toggleConfig}
                aria-expanded={configOpen}
                aria-controls="config-submenu"
              >
                <MdSettings className="dl-nav__icon" aria-hidden="true" />
                <span className="dl-nav__label">Configuration</span>
                <MdKeyboardArrowDown
                  className={`dl-nav__arrow${configOpen ? " dl-nav__arrow--open" : ""}`}
                  aria-hidden="true"
                />
              </button>

              <div
                id="config-submenu"
                className={`dl-submenu${configOpen ? " dl-submenu--open" : ""}`}
                role="region"
                aria-label="Configuration submenu"
              >
                <div className="dl-submenu__inner">
                  <Can permission="companies.manage.view">
                    <NavLink
                      to="/companies/list"
                      className={({ isActive }) =>
                        "dl-submenu__item" + (isActive ? " active" : "")
                      }
                    >
                      <MdBusiness aria-hidden="true" style={{ fontSize: "0.95rem", flexShrink: 0 }} />
                      Companies List
                    </NavLink>
                  </Can>
                  <Can permission="clients.manage.view">
                    <NavLink
                      to="/Clients/list"
                      className={({ isActive }) =>
                        "dl-submenu__item" + (isActive ? " active" : "")
                      }
                    >
                      <MdPeople aria-hidden="true" style={{ fontSize: "0.95rem", flexShrink: 0 }} />
                      Clients List
                    </NavLink>
                  </Can>
                  <Can permission="suppliers.manage.view">
                    <NavLink
                      to="/Suppliers/list"
                      className={({ isActive }) =>
                        "dl-submenu__item" + (isActive ? " active" : "")
                      }
                    >
                      <MdLocalShipping aria-hidden="true" style={{ fontSize: "0.95rem", flexShrink: 0 }} />
                      Suppliers List
                    </NavLink>
                  </Can>
                  <Can permission="itemtypes.manage.view">
                    <NavLink
                      to="/item-types"
                      className={({ isActive }) =>
                        "dl-submenu__item" + (isActive ? " active" : "")
                      }
                    >
                      <MdCategory aria-hidden="true" style={{ fontSize: "0.95rem", flexShrink: 0 }} />
                      Item Types
                    </NavLink>
                  </Can>
                  <Can permission="config.units.manage">
                    <NavLink
                      to="/units"
                      className={({ isActive }) =>
                        "dl-submenu__item" + (isActive ? " active" : "")
                      }
                    >
                      <MdStraighten aria-hidden="true" style={{ fontSize: "0.95rem", flexShrink: 0 }} />
                      Units
                    </NavLink>
                  </Can>
                  <Can permission="poformats.manage.view">
                    <NavLink
                      to="/po-formats"
                      className={({ isActive }) =>
                        "dl-submenu__item" + (isActive ? " active" : "")
                      }
                    >
                      <MdDescription aria-hidden="true" style={{ fontSize: "0.95rem", flexShrink: 0 }} />
                      PO Formats
                    </NavLink>
                  </Can>
                  <Can permission="printtemplates.manage.update">
                    <NavLink
                      to="/templates"
                      className={({ isActive }) =>
                        "dl-submenu__item" + (isActive ? " active" : "")
                      }
                    >
                      <MdCode aria-hidden="true" style={{ fontSize: "0.95rem", flexShrink: 0 }} />
                      Print Templates
                    </NavLink>
                  </Can>
                  <Can permission="fbr.config.update">
                    <NavLink
                      to="/fbr-settings"
                      className={({ isActive }) =>
                        "dl-submenu__item" + (isActive ? " active" : "")
                      }
                    >
                      <MdTune aria-hidden="true" style={{ fontSize: "0.95rem", flexShrink: 0 }} />
                      FBR Settings
                    </NavLink>
                  </Can>
                  <Can permission="fbr.sandbox.view">
                    <NavLink
                      to="/fbr-sandbox"
                      className={({ isActive }) =>
                        "dl-submenu__item" + (isActive ? " active" : "")
                      }
                    >
                      <MdScience aria-hidden="true" style={{ fontSize: "0.95rem", flexShrink: 0 }} />
                      FBR Sandbox
                    </NavLink>
                  </Can>
                </div>
              </div>
            </>
          )}

          <hr className="dl-nav__divider" />
          <span className="dl-nav__section-label">Sales</span>

          <Can permission="invoices.list.view">
            <NavLink
              to="/invoices"
              className={({ isActive }) =>
                "dl-nav__item" + (isActive ? " active" : "")
              }
            >
              <MdReceipt className="dl-nav__icon" aria-hidden="true" />
              <span className="dl-nav__label">Bills</span>
            </NavLink>
          </Can>

          <Can permission="itemratehistory.view">
            <NavLink
              to="/item-rate-history"
              className={({ isActive }) =>
                "dl-nav__item" + (isActive ? " active" : "")
              }
            >
              <MdHistory className="dl-nav__icon" aria-hidden="true" />
              <span className="dl-nav__label">Item Rate History</span>
            </NavLink>
          </Can>

          <Can permission="challans.list.view">
            <NavLink
              to="/challans"
              className={({ isActive }) =>
                "dl-nav__item" + (isActive ? " active" : "")
              }
            >
              <MdDescription className="dl-nav__icon" aria-hidden="true" />
              <span className="dl-nav__label">Delivery Challans</span>
            </NavLink>
          </Can>

          <Can permission="challans.import.create">
            <NavLink
              to="/challans/import"
              className={({ isActive }) =>
                "dl-nav__item" + (isActive ? " active" : "")
              }
            >
              <MdFileUpload className="dl-nav__icon" aria-hidden="true" />
              <span className="dl-nav__label">Import Challans</span>
            </NavLink>
          </Can>

          <hr className="dl-nav__divider" />
          <span className="dl-nav__section-label">Purchases</span>

          <Can permission="purchasebills.list.view">
            <NavLink
              to="/purchase-bills"
              className={({ isActive }) =>
                "dl-nav__item" + (isActive ? " active" : "")
              }
            >
              <MdShoppingCart className="dl-nav__icon" aria-hidden="true" />
              <span className="dl-nav__label">Purchase Bills</span>
            </NavLink>
          </Can>

          <Can permission="goodsreceipts.list.view">
            <NavLink
              to="/goods-receipts"
              className={({ isActive }) =>
                "dl-nav__item" + (isActive ? " active" : "")
              }
            >
              <MdInventory2 className="dl-nav__icon" aria-hidden="true" />
              <span className="dl-nav__label">Goods Receipts</span>
            </NavLink>
          </Can>

          <Can permission="stock.dashboard.view">
            <NavLink
              to="/stock"
              className={({ isActive }) =>
                "dl-nav__item" + (isActive ? " active" : "")
              }
            >
              <MdInventory className="dl-nav__icon" aria-hidden="true" />
              <span className="dl-nav__label">Stock Dashboard</span>
            </NavLink>
          </Can>

          <hr className="dl-nav__divider" />
          <span className="dl-nav__section-label">Administration</span>

          <Can permission="users.manage.view">
            <NavLink
              to="/users"
              className={({ isActive }) =>
                "dl-nav__item" + (isActive ? " active" : "")
              }
            >
              <MdGroupAdd className="dl-nav__icon" aria-hidden="true" />
              <span className="dl-nav__label">Users</span>
            </NavLink>
          </Can>

          <Can permission="rbac.roles.view">
            <NavLink
              to="/roles"
              className={({ isActive }) =>
                "dl-nav__item" + (isActive ? " active" : "")
              }
            >
              <MdAdminPanelSettings className="dl-nav__icon" aria-hidden="true" />
              <span className="dl-nav__label">Roles &amp; Permissions</span>
            </NavLink>
          </Can>

          <Can permission="auditlogs.view">
            <NavLink
              to="/audit-logs"
              className={({ isActive }) =>
                "dl-nav__item" + (isActive ? " active" : "")
              }
            >
              <MdBugReport className="dl-nav__icon" aria-hidden="true" />
              <span className="dl-nav__label">Audit Logs</span>
            </NavLink>
          </Can>

        </nav>

        {/* Account & Footer – always visible, never scroll */}
        <div className="dl-sidebar-bottom">
          <hr className="dl-nav__divider" />
          <span className="dl-nav__section-label">Account</span>
          <NavLink
            to="/profile"
            className={({ isActive }) =>
              "dl-nav__item" + (isActive ? " active" : "")
            }
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="dl-nav__avatar-img" aria-hidden="true" />
            ) : (
              <MdAccountCircle className="dl-nav__icon" aria-hidden="true" />
            )}
            <span className="dl-nav__label">My Profile</span>
          </NavLink>
          <p className="dl-sidebar-footer__copy">
            &copy; {new Date().getFullYear()} FBR Digital Invoicing ERP
          </p>
          <button
            type="button"
            className="dl-logout-btn"
            onClick={logout}
            aria-label="Logout"
          >
            <MdLogout aria-hidden="true" />
            Logout
          </button>
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
    "/templates": "Print Templates",
    "/fbr-settings": "Configuration / FBR Settings",
    "/fbr-sandbox": "Configuration / FBR Sandbox",
    "/audit-logs": "Audit Logs",
  };
  return map[pathname] ?? pathname.replace(/\//g, " / ").replace(/^\s\/\s/, "");
}
