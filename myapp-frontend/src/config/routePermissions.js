// ─────────────────────────────────────────────────────────────────────────────
// Route → permission map
// ─────────────────────────────────────────────────────────────────────────────
// The sidebar has always hidden a link the operator cannot use, but hiding a
// link is not access control: the URL still worked. Typing /chart-of-accounts
// on a role without `accounting.coa.view` used to mount the page, fire its
// loads, and leave the operator staring at a half-drawn screen full of 403s.
//
// Every protected route now names the permission it needs, in ONE place, and
// `Components/RequirePermission.jsx` enforces it before the page mounts. The
// server is still the authority — every endpoint carries [HasPermission] — this
// is what makes the refusal honest and legible instead of a broken screen.
//
// HOW TO ADD A SCREEN
// -------------------
// 1. Add the route to `App.jsx` as usual.
// 2. Add its path here with the permission key that governs it — normally the
//    same key the sidebar link is gated on, so the link and the URL agree.
// 3. If the screen is open to every signed-in user (a personal page, not a
//    tenant feature), map it to `PUBLIC_TO_SIGNED_IN`.
//
// `scripts/test_route_permissions.mjs` fails if a route in App.jsx is missing
// here, or names a key that is not in the backend catalog. A screen cannot be
// added without deciding who may see it.
// ─────────────────────────────────────────────────────────────────────────────

/** A route every authenticated user may open, regardless of role. */
export const PUBLIC_TO_SIGNED_IN = null;

export const ROUTE_PERMISSIONS = {
  // Home
  "/dashboard": "dashboard.view",
  // The operator's own account — never a tenant feature.
  "/profile": PUBLIC_TO_SIGNED_IN,

  // Sales
  "/sales-quotes": "salesquotes.list.view",
  "/sales-orders": "salesorders.list.view",
  "/challans": "challans.list.view",
  "/challans/import": "challans.import.create",
  "/bills": "bills.list.view",
  "/invoices": "invoices.list.view",
  "/credit-notes": "invoices.list.view",
  "/debit-notes": "invoices.list.view",
  // The note CREATE screen, not a list — gated on the create key so a
  // read-only role cannot open a form it may not submit.
  "/credit-debit-notes": "invoices.note.create",
  "/item-rate-history": "itemratehistory.view",

  // Purchases
  "/purchase-bills": "purchasebills.list.view",
  "/goods-receipts": "goodsreceipts.list.view",
  "/stock": "stock.dashboard.view",
  "/fbr-import/purchase": "fbrimport.purchase.preview",

  // Money in / money out — part of the Sales edition, they predate the
  // accounting module and do not require the general ledger.
  "/receipts": "accounting.receipts.view",
  "/payments": "accounting.payments.view",

  // Accounting module
  "/chart-of-accounts": "accounting.coa.view",
  "/journal-entries": "accounting.journal.view",
  "/accounting/overview": "accounting.reports.view",
  "/accounting/reports": "accounting.reports.view",
  "/customer-portals": "customerportals.manage.view",

  // Reports
  "/reports/sales": "reports.sales.view",
  "/reports/tax-sheet": "reports.taxsheet.view",
  "/reports/outstanding": "reports.outstanding.view",

  // Configuration
  "/companies/*": "companies.manage.view",
  "/Clients/*": "clients.manage.view",
  "/Suppliers/*": "suppliers.manage.view",
  "/item-types": "itemtypes.manage.view",
  "/units": "config.units.manage",
  "/po-formats": "poformats.manage.view",
  "/templates": "printtemplates.manage.update",
  "/templates/edit": "printtemplates.manage.update",
  "/configuration/navigation-menu": "folders.list.view",
  "/fbr-settings": "fbr.config.update",
  "/fbr-sandbox": "fbr.sandbox.view",
  "/fbr-monitor": "fbrmonitor.view",

  // Administration
  "/users": "users.manage.view",
  "/roles": "rbac.roles.view",
  "/tenant-access": "tenantaccess.manage.view",
  // The Administrators tree is seed-admin-only on the server; the same key
  // the controller carries is what opens the screen.
  "/administrators": "users.manage.view",
  "/audit-logs": "auditlogs.view",
};

/**
 * The permission a pathname needs, or null when the route is open to every
 * signed-in user. `undefined` means the path is not in the map at all — the
 * guard treats that as "no decision recorded" and refuses, so a screen added
 * without an entry fails closed rather than open.
 */
export function permissionForPath(pathname) {
  if (Object.prototype.hasOwnProperty.call(ROUTE_PERMISSIONS, pathname)) {
    return ROUTE_PERMISSIONS[pathname];
  }
  // Wildcard entries ("/companies/*"). Longest prefix wins so a more specific
  // pattern can be added later without reordering the object.
  let best;
  let bestLength = -1;
  for (const [pattern, key] of Object.entries(ROUTE_PERMISSIONS)) {
    if (!pattern.endsWith("/*")) continue;
    const prefix = pattern.slice(0, -2);
    if (pathname === prefix || pathname.startsWith(prefix + "/")) {
      if (prefix.length > bestLength) { bestLength = prefix.length; best = key; }
    }
  }
  return bestLength >= 0 ? best : undefined;
}
