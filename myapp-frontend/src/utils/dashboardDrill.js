// Pure logic for the dashboard drill-down panel (no React, testable under node).
import { csvSafe } from "./csvSafe.js";

// URL state: ?drill=<kind>&group=<groupKey>.
export function drillFromSearch(params) {
  const kind = params.get("drill");
  if (!kind) return null;
  return { kind, groupKey: params.get("group") || null };
}

// Returns a NEW URLSearchParams; null state clears both keys.
export function drillToSearch(params, state) {
  const next = new URLSearchParams(params);
  next.delete("drill");
  next.delete("group");
  if (state?.kind) {
    next.set("drill", state.kind);
    if (state.groupKey) next.set("group", state.groupKey);
  }
  return next;
}

// Rows add up to the card within a paisa-ish tolerance.
export function reconciles(rows, total, tolerance = 0.05) {
  if (total == null) return true;
  const sum = (rows || []).reduce((a, r) => a + (Number(r.amount) || 0), 0);
  return Math.abs(sum - Number(total)) < tolerance;
}

// Header row + one line per row, every string through csvSafe.
export function exportRows(columns, rows) {
  const cols = columns || [];
  // Only strings can be formulas; a negative NUMBER must stay a number.
  const safe = (v) => (typeof v === "string" ? csvSafe(v) : (v ?? ""));
  const head = ["Name", "Detail", "Amount", ...cols.map((c) => c.label)].map(safe);
  const body = (rows || []).map((r) => [
    r.label, r.sub, r.amount, ...cols.map((c) => r.values?.[c.key]),
  ].map(safe));
  return [head, ...body];
}

// The invoice's tax build-up shown when a row is expanded.
export function invoiceBreakdown(values, statusLabel) {
  const v = values || {};
  const adv = Number(v.adv236) || 0;
  return [
    { label: "Net", value: v.net, money: true },
    { label: "GST", value: v.gst, money: true },
    { label: "Further tax", value: v.furtherTax, money: true },
    { label: v.advSection ? `Advance tax ${v.advSection}` : "Advance tax 236G/H", value: adv, money: true },
    { label: "Withholding tax", value: v.wht, money: true },
    { label: "Grand total", value: v.grandTotal, money: true },
    { label: "FBR status", value: statusLabel(v.fbrStatus), money: false },
  ];
}

// Credit and debit notes are numbered per kind, so each opens on its own
// screen (gated like the sidebar link to it); everything else is a bill.
const DOC_SCREENS = {
  bill: { path: "/bills", permission: "bills.list.view", label: "Open bill" },
  creditNote: { path: "/credit-notes", permission: "invoices.list.view", label: "Open credit note" },
  debitNote: { path: "/debit-notes", permission: "invoices.list.view", label: "Open debit note" },
};

export function openDocScreen(docType) {
  return DOC_SCREENS[docType] || DOC_SCREENS.bill;
}

export function openBillPath(invoiceNumber, docType) {
  return `${openDocScreen(docType).path}?search=${encodeURIComponent(invoiceNumber)}`;
}
