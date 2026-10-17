// Pure logic for the dashboard drill-down panel (no React, testable under node).

// Same rule as the server's CsvSafe: a leading = + - @ tab or CR makes Excel
// read the cell as a formula, so prefix it with a quote.
export function csvSafe(raw) {
  const s = String(raw ?? "");
  if (!s) return s;
  return "=+-@\t\r".includes(s[0]) ? "'" + s : s;
}

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
  const head = ["Name", "Detail", "Amount", ...cols.map((c) => c.label)].map(csvSafe);
  const body = (rows || []).map((r) => [
    r.label, r.sub, r.amount, ...cols.map((c) => r.values?.[c.key]),
  ].map((v) => csvSafe(v ?? "")));
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

export function openBillPath(invoiceNumber) {
  return `/bills?search=${encodeURIComponent(invoiceNumber)}`;
}
