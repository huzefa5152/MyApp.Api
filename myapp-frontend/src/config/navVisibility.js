// ─────────────────────────────────────────────────────────────────────────────
// Sidebar nav-item visibility
// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for which sidebar tabs are SHOWN. This is a pure
// presentation switch — it hides the nav entry only. Routes, pages, APIs,
// services, permissions and the RBAC catalog are all untouched, so a hidden
// feature keeps working: it is still reachable by URL, still gated by its own
// permission, and still assignable in Roles & Permissions.
//
// HOW TO BRING A TAB BACK
// -----------------------
// Flip its `visible` to `true` below. Nothing else — the sidebar link, the
// section badge count, and the section header re-appear on the next build.
//
// HOW TO HIDE A NEW TAB
// ---------------------
// Add an entry with the nav link's `path` + the `permission` its <Can> gate
// uses, and `visible: false`. `path` must match the NavLink `to` in
// DashboardLayout.jsx; `permission` must match the key in that section's
// *Keys array there, so the "[N]" badge and the section gate stay in sync.
//
// Deliberately NOT a runtime/admin setting: this is a per-deployment build
// choice, so it lives in code next to the nav that consumes it.
// ─────────────────────────────────────────────────────────────────────────────

export const NAV_ITEMS = [
  // ── Sales ────────────────────────────────────────────────────────────────
  { path: "/sales-quotes",              permission: "salesquotes.list.view",       label: "Sales Quotes",       visible: false },
  { path: "/sales-orders",              permission: "salesorders.list.view",       label: "Sales Orders",       visible: false },
  { path: "/challans/import",           permission: "challans.import.create",      label: "Import Challans",    visible: false },

  // ── Settings ─────────────────────────────────────────────────────────────
  { path: "/fbr-settings",              permission: "fbr.config.update",           label: "FBR Settings",       visible: false },
  { path: "/fbr-sandbox",               permission: "fbr.sandbox.view",            label: "FBR Sandbox",        visible: false },
  { path: "/fbr-monitor",               permission: "fbrmonitor.view",             label: "FBR Monitor",        visible: false },

  // ── Administration ───────────────────────────────────────────────────────
  { path: "/accounting/data-migration", permission: "accounting.import.run",       label: "Data Migration",     visible: false },
  { path: "/accounting/manager-import", permission: "accounting.import.manager",   label: "Manager.io Import",  visible: false },
];

// Anything not listed above is visible — the list only ever carries exceptions.
const HIDDEN_PATHS = new Set(NAV_ITEMS.filter((i) => !i.visible).map((i) => i.path));
const HIDDEN_PERMISSIONS = new Set(NAV_ITEMS.filter((i) => !i.visible).map((i) => i.permission));

/** True when the sidebar link for this route should render. */
export function isNavPathVisible(path) {
  return !HIDDEN_PATHS.has(path);
}

/** True when the nav item gated by this permission key should render. */
export function isNavPermissionVisible(permission) {
  return !HIDDEN_PERMISSIONS.has(permission);
}

/**
 * Drop hidden items from a section's permission-key list, so the section's
 * "[N]" badge and its show/hide gate count only what the user can actually see.
 */
export function visibleNavPermissions(keys) {
  return keys.filter(isNavPermissionVisible);
}
