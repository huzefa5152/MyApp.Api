// ─────────────────────────────────────────────────────────────────────────────
// Permission section layout — the Roles & Permissions editor's tree
// ─────────────────────────────────────────────────────────────────────────────
// The editor reads: SECTION (here) -> MODULE -> PAGE -> ACTION (catalog).
// Sections are the SIDEBAR's own groups, in sidebar order, so an admin finds a
// permission where they find the screen. Module / page / action are the plain
// words in Helpers/PermissionCatalog.cs; the module string IS the label.
//
// The full rule (naming, vocabulary, how to add a feature's permission) is
// CLAUDE.md §2b. scripts/verify_permission_sections.py enforces it: every
// catalog module listed below exactly once, no stale entries, no developer
// words in the labels.
// ─────────────────────────────────────────────────────────────────────────────

export const PERMISSION_SECTIONS = [
  {
    section: "Dashboards",
    modules: [
      { key: "Overview Dashboard" },
      { key: "Accounting Dashboard" },
    ],
  },
  {
    section: "Stock",
    modules: [
      { key: "Stock" },
    ],
  },
  {
    section: "Sales",
    modules: [
      { key: "Sales Quotes" },
      { key: "Sales Orders" },
      { key: "Delivery Challans" },
      { key: "Bills" },
      { key: "Invoices" },
      { key: "Withholding Tax" },
      { key: "Item Rate History" },
    ],
  },
  {
    section: "Purchases",
    modules: [
      { key: "Purchase Bills" },
      { key: "Purchase Debit Notes" },
      { key: "Goods Receipts" },
      { key: "FBR Purchase Import" },
      { key: "Import Costing" },
    ],
  },
  {
    section: "Accounting",
    modules: [
      { key: "Bank & Cash Accounts" },
      { key: "Receipts" },
      { key: "Payments" },
      { key: "Customer Ledger" },
      { key: "Transfers" },
      { key: "Journal Entries" },
      { key: "Chart of Accounts" },
      { key: "Spreadsheet Import" },
    ],
  },
  {
    section: "Reports",
    modules: [
      { key: "Reports" },
    ],
  },
  {
    section: "Master Data",
    modules: [
      { key: "Clients" },
      { key: "Suppliers" },
      { key: "Item Types" },
      { key: "HS Codes" },
      { key: "Non-Inventory Items" },
      { key: "Units & Descriptions" },
    ],
  },
  {
    section: "Settings",
    modules: [
      { key: "Companies" },
      { key: "Divisions" },
      { key: "Customer Portal" },
      { key: "Print Templates" },
      { key: "PO Formats" },
      { key: "FBR" },
      { key: "Folders & Attachments" },
      { key: "Import Feedback" },
    ],
  },
  {
    section: "Administration",
    modules: [
      { key: "Users" },
      { key: "Roles & Permissions" },
      { key: "Tenant Access" },
      { key: "Division Access" },
      { key: "Audit Logs" },
      { key: "Data Migration" },
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
