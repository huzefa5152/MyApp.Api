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
} from "react-icons/md";
import { useAuth } from "../contexts/AuthContext";
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
  const location = useLocation();
  const navigate = useNavigate();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);

  // Auto-expand Configuration submenu if a child route is active
  const isConfigActive = location.pathname.startsWith("/companies") || location.pathname.startsWith("/Clients") || location.pathname.startsWith("/item-types") || location.pathname.startsWith("/templates");
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
          <span className="dl-brand__icon" aria-hidden="true">🏪</span>
          <h1 className="dl-brand__name">Hakimi Traders</h1>
          <p className="dl-brand__tagline">Business Management Portal</p>
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

          {/* Configuration (expandable) */}
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

          {/* Submenu */}
          <div
            id="config-submenu"
            className={`dl-submenu${configOpen ? " dl-submenu--open" : ""}`}
            role="region"
            aria-label="Configuration submenu"
          >
            <div className="dl-submenu__inner">
              <NavLink
                to="/companies/list"
                className={({ isActive }) =>
                  "dl-submenu__item" + (isActive ? " active" : "")
                }
              >
                <MdBusiness aria-hidden="true" style={{ fontSize: "0.95rem", flexShrink: 0 }} />
                Companies List
              </NavLink>
              <NavLink
                to="/Clients/list"
                className={({ isActive }) =>
                  "dl-submenu__item" + (isActive ? " active" : "")
                }
              >
                <MdPeople aria-hidden="true" style={{ fontSize: "0.95rem", flexShrink: 0 }} />
                Clients List
              </NavLink>
              <NavLink
                to="/item-types"
                className={({ isActive }) =>
                  "dl-submenu__item" + (isActive ? " active" : "")
                }
              >
                <MdCategory aria-hidden="true" style={{ fontSize: "0.95rem", flexShrink: 0 }} />
                Item Types
              </NavLink>
              <NavLink
                to="/templates"
                className={({ isActive }) =>
                  "dl-submenu__item" + (isActive ? " active" : "")
                }
              >
                <MdCode aria-hidden="true" style={{ fontSize: "0.95rem", flexShrink: 0 }} />
                Print Templates
              </NavLink>
            </div>
          </div>

          {/* Challans */}
          <NavLink
            to="/challans"
            className={({ isActive }) =>
              "dl-nav__item" + (isActive ? " active" : "")
            }
          >
            <MdDescription className="dl-nav__icon" aria-hidden="true" />
            <span className="dl-nav__label">Challans</span>
          </NavLink>

          {/* Invoices */}
          <NavLink
            to="/invoices"
            className={({ isActive }) =>
              "dl-nav__item" + (isActive ? " active" : "")
            }
          >
            <MdReceipt className="dl-nav__icon" aria-hidden="true" />
            <span className="dl-nav__label">Invoices</span>
          </NavLink>

          {/* Users */}
          <NavLink
            to="/users"
            className={({ isActive }) =>
              "dl-nav__item" + (isActive ? " active" : "")
            }
          >
            <MdGroupAdd className="dl-nav__icon" aria-hidden="true" />
            <span className="dl-nav__label">Users</span>
          </NavLink>

          {/* Audit Logs */}
          <NavLink
            to="/audit-logs"
            className={({ isActive }) =>
              "dl-nav__item" + (isActive ? " active" : "")
            }
          >
            <MdBugReport className="dl-nav__icon" aria-hidden="true" />
            <span className="dl-nav__label">Audit Logs</span>
          </NavLink>

          <hr className="dl-nav__divider" />
          <span className="dl-nav__section-label">Account</span>

          {/* Profile */}
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
        </nav>

        {/* Footer */}
        <div className="dl-sidebar-footer">
          <p className="dl-sidebar-footer__copy">
            &copy; {new Date().getFullYear()} Hakimi Traders
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
    "/item-types": "Configuration / Item Types",
    "/challans": "Challans",
    "/invoices": "Invoices",
    "/profile": "My Profile",
    "/users": "User Management",
    "/templates": "Print Templates",
    "/audit-logs": "Audit Logs",
  };
  return map[pathname] ?? pathname.replace(/\//g, " / ").replace(/^\s\/\s/, "");
}
