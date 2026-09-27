// Decisions for the Import Data screen, kept free of React so they can be
// tested under plain node (scripts/test_onboarding_import.mjs). The page only
// draws what these return.
//
// The server is the authority on every rule: which columns a sheet has, what
// is required, what already exists. This file decides only what the screen
// shows and which sheets it asks for.

export const IMPORT_PERMISSION = "onboarding.import.run";

// Display order. The server imports in its own order (items before opening
// stock), whatever order these are sent in.
export const SHEETS = [
  {
    key: "customers",
    title: "Customers",
    permission: "clients.manage.create",
    viewPermission: "clients.manage.view",
    blurb: "Who you sell to: name, registration type, NTN or CNIC, province, address.",
    required: 3,
    listPath: "/Clients/list",
    listLabel: "Customers",
  },
  {
    key: "items",
    title: "Items",
    permission: "itemtypes.manage.create",
    viewPermission: "itemtypes.manage.view",
    blurb: "What you bill: item name, HS code, unit and sale type.",
    required: 1,
    listPath: "/item-types",
    listLabel: "Item Types",
  },
  {
    key: "suppliers",
    title: "Suppliers",
    permission: "suppliers.manage.create",
    viewPermission: "suppliers.manage.view",
    blurb: "Who you buy from: the same identity details as customers.",
    required: 2,
    listPath: "/Suppliers/list",
    listLabel: "Suppliers",
  },
  {
    key: "openingStock",
    title: "Opening Stock",
    permission: "stock.opening.manage",
    viewPermission: "stock.dashboard.view",
    blurb: "What you hold on your first day: item, quantity and date.",
    required: 3,
    listPath: "/stock",
    listLabel: "Stock",
  },
];

export const sheetByKey = (key) => SHEETS.find((s) => s.key === key) || null;

/** The sheets this user can create records for. `has` is usePermissions().has. */
export function allowedSheets(has) {
  return SHEETS.filter((s) => has(s.permission));
}

/**
 * Initial selection from the URL (?sheets=customers,items), limited to what
 * the user may import. Nothing named, or nothing valid, selects everything
 * allowed — the "Everything" case.
 */
export function sheetsFromQuery(search, allowedKeys) {
  const raw = new URLSearchParams(search || "").get("sheets") || "";
  const asked = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const picked = allowedKeys.filter((k) => asked.some((a) => a.toLowerCase() === k.toLowerCase()));
  return picked.length ? picked : [...allowedKeys];
}

/** The link each list page's "Import from Excel" button opens. */
export const importLinkFor = (key) => `/import-data?sheets=${encodeURIComponent(key)}`;

/** The comma-separated list the API takes, in display order. */
export const sheetsParam = (keys) => SHEETS.map((s) => s.key).filter((k) => keys.includes(k)).join(",");

export const STATUS = {
  import:  { label: "Will import",            color: "#1b5e20", bg: "#e8f5e9", border: "#a5d6a7" },
  warning: { label: "Imports with a warning", color: "#8a4b00", bg: "#fff4e0", border: "#ffcc80" },
  exists:  { label: "Already exists, skipped", color: "#37474f", bg: "#eceff1", border: "#b0bec5" },
  error:   { label: "Needs fixing",           color: "#b71c1c", bg: "#ffebee", border: "#ef9a9a" },
};

export const STATUS_ORDER = ["error", "warning", "import", "exists"];

/** Totals across every sheet of a preview. */
export function summarise(preview) {
  const t = { toImport: 0, withWarnings: 0, existing: 0, errors: 0, rows: 0 };
  for (const s of preview?.sheets || []) {
    t.toImport += s.toImport || 0;
    t.withWarnings += s.withWarnings || 0;
    t.existing += s.existing || 0;
    t.errors += s.errors || 0;
    t.rows += (s.rows || []).length;
  }
  t.willCreate = t.toImport + t.withWarnings;
  return t;
}

/** Rows of one sheet with the given status ("all" for every row), refused rows first. */
export function rowsFor(sheetPreview, status = "all") {
  const rows = sheetPreview?.rows || [];
  const picked = status === "all" ? rows : rows.filter((r) => r.status === status);
  return [...picked].sort((a, b) =>
    STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.rowNumber - b.rowNumber);
}

/** "Row 14 · NTN: must be 7 digits" — the line shown under a row. */
export function issueLine(issue) {
  return issue.column ? `${issue.column}: ${issue.message}` : issue.message;
}

/** A sheet chosen on screen that the uploaded file did not contain at all. */
export function missingSheets(preview) {
  return (preview?.sheets || []).filter((s) => !s.present).map((s) => s.title);
}

/**
 * The footer checklist: what is still needed before the import can run, in
 * the order the operator meets it.
 */
export function checklist({ selected, file, preview, busy, result }) {
  if (result) return [{ done: true, text: `Imported ${result.totalCreated} record${result.totalCreated === 1 ? "" : "s"}` }];
  const items = [];
  items.push({ done: selected.length > 0, text: selected.length ? `${selected.length} sheet${selected.length === 1 ? "" : "s"} chosen` : "Choose at least one sheet" });
  items.push({ done: !!file, text: file ? `File: ${file.name}` : "Upload your filled-in file" });
  if (file && !preview) items.push({ done: false, text: busy ? "Checking the file…" : "Waiting for the check" });
  if (preview) {
    const t = summarise(preview);
    if (t.errors) items.push({ done: true, warn: true, text: `${t.errors} row${t.errors === 1 ? " needs" : "s need"} fixing; ${t.errors === 1 ? "it" : "they"} will be skipped` });
    items.push({ done: t.willCreate > 0, text: t.willCreate ? `${t.willCreate} row${t.willCreate === 1 ? "" : "s"} ready to import` : "Nothing new to import in this file" });
  }
  return items;
}

export const canImport = (preview, busy) => !busy && summarise(preview).willCreate > 0;

/** A file name for the sample: "import-data-hakimi-traders.xlsx". */
export function sampleFileName(companyName) {
  const slug = String(companyName || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug ? `import-data-${slug}.xlsx` : "import-data.xlsx";
}

export const ACCEPTED_EXTENSIONS = [".xlsx", ".xls"];
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Null when the file can be sent; otherwise the reason it cannot. */
export function fileProblem(file) {
  if (!file) return "Choose a file.";
  const name = String(file.name || "").toLowerCase();
  if (!ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))) return "Choose an Excel file (.xlsx or .xls).";
  if (file.size > MAX_UPLOAD_BYTES) return "The file is larger than 10 MB.";
  if (file.size === 0) return "The file is empty.";
  return null;
}
