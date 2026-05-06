// ─────────────────────────────────────────────────────────────────────────────
// Permission section layout
// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for how the Roles & Permissions editor groups the
// raw permission catalog (whose first-level grouping is `Module`) under the
// app's navbar super-groups (Sales / Purchases / Configuration /
// Administration), so the editor mirrors what users see in the sidebar.
//
// HOW TO ADD A NEW MODULE OR SCREEN
// ---------------------------------
// 1. Add the permission(s) to `Helpers/PermissionCatalog.cs` (backend) using
//    a Module name — e.g. "MyNewModule".
// 2. Add ONE entry below in the `modules` array of the section it belongs
//    under: `{ key: "MyNewModule", label: "My New Module" }`.
// 3. If the module needs a brand-new section (e.g. "Reports"), append a
//    section object to PERMISSION_SECTIONS — that's it; the editor will
//    render it automatically with header, expand/collapse, and bulk-select.
//
// The `key` MUST match the catalog `Module` string exactly. The optional
// `label` overrides the displayed name (use it when the catalog uses a
// CamelCase key like "PurchaseBills" but you want "Purchase Bills" in the UI).
// Modules in the catalog that aren't listed here fall through to "Other"
// so they still render — they just look uncategorized until added below.
// ─────────────────────────────────────────────────────────────────────────────

export const PERMISSION_SECTIONS = [
  {
    section: "Sales",
    modules: [
      { key: "Challans", label: "Delivery Challans" },
      // Bills (data entry) and Invoices (FBR submission) are two views of
      // the same underlying bill data. Each has its own permission namespace
      // so a bookkeeper role can hold bills.* without invoices.fbr.*, and
      // an FBR officer role can hold invoices.* without bills.manage.*.
      { key: "Bills", label: "Bill" },
      { key: "Invoices" },
      { key: "Item Rate History" },
    ],
  },
  {
    section: "Purchases",
    modules: [
      { key: "PurchaseBills", label: "Purchase Bills" },
      { key: "GoodsReceipts", label: "Goods Receipts" },
      { key: "Inventory" },
    ],
  },
  {
    section: "Configuration",
    modules: [
      { key: "Companies" },
      { key: "Clients" },
      { key: "Suppliers" },
      { key: "ItemTypes", label: "Item Types" },
      { key: "Configuration", label: "Lookups" },
      { key: "POFormats", label: "PO Formats" },
      { key: "PrintTemplates", label: "Print Templates" },
      { key: "FBR" },
    ],
  },
  {
    section: "Administration",
    modules: [
      { key: "Users" },
      { key: "RBAC", label: "Roles & Permissions" },
      { key: "Tenant Access" },
      { key: "AuditLogs", label: "Audit Logs" },
    ],
  },
];

// Catch-all bucket name used for any catalog Module not listed above.
// Kept here so the renderer doesn't hardcode it in two places.
export const FALLBACK_SECTION = "Other";

// Build a quick lookup: module key → { section, label }. Memoised at module
// load — the layout config is static, so there's no need to rebuild it on
// every render.
const moduleIndex = (() => {
  const map = new Map();
  PERMISSION_SECTIONS.forEach((sec) => {
    sec.modules.forEach((m) => {
      map.set(m.key, { section: sec.section, label: m.label });
    });
  });
  return map;
})();

export function getModuleSection(moduleKey) {
  return moduleIndex.get(moduleKey)?.section || FALLBACK_SECTION;
}

export function getModuleLabel(moduleKey) {
  return moduleIndex.get(moduleKey)?.label || moduleKey;
}

// Re-bucket a flat tree (the API's `[{ module, pages: [...] }, ...]` shape)
// into `[{ section, modules: [...] }, ...]` in PERMISSION_SECTIONS order,
// with the FALLBACK_SECTION appended at the end if any uncategorized modules
// exist. Empty sections are dropped so the operator sees only what the
// current tenant actually has permissions for.
export function groupTreeBySections(tree) {
  const buckets = new Map();
  PERMISSION_SECTIONS.forEach((s) => buckets.set(s.section, []));
  buckets.set(FALLBACK_SECTION, []);

  tree.forEach((mod) => {
    const section = getModuleSection(mod.module);
    if (!buckets.has(section)) buckets.set(section, []);
    buckets.get(section).push(mod);
  });

  // Preserve the explicit module ordering inside each section as defined
  // in PERMISSION_SECTIONS, so the editor reads the same way every time
  // regardless of whatever order the API returns them in.
  PERMISSION_SECTIONS.forEach((sec) => {
    const order = new Map(sec.modules.map((m, idx) => [m.key, idx]));
    buckets.get(sec.section).sort((a, b) => {
      const ai = order.has(a.module) ? order.get(a.module) : Number.MAX_SAFE_INTEGER;
      const bi = order.has(b.module) ? order.get(b.module) : Number.MAX_SAFE_INTEGER;
      return ai - bi;
    });
  });

  const ordered = [
    ...PERMISSION_SECTIONS.map((s) => ({ section: s.section, modules: buckets.get(s.section) })),
    { section: FALLBACK_SECTION, modules: buckets.get(FALLBACK_SECTION) },
  ];
  return ordered.filter((s) => s.modules.length > 0);
}
