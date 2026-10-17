// Invoice Sales Detail — what the SCREEN decides about the report.
//
// The server selects the bills (period + filters, ONE query for the screen and
// the Excel, see Helpers/InvoiceSalesDetailFilter.cs). This module only reads the
// answer: which filters are applied, how lines group into bills, which bills are
// on a page, the totals and the workbook filename.

const PERIOD_OPTIONS = [
  { value: "today", label: "Today" }, { value: "thisWeek", label: "This week" },
  { value: "thisMonth", label: "This month" }, { value: "lastMonth", label: "Last month" },
  { value: "thisQuarter", label: "This quarter" }, { value: "thisYear", label: "This year" },
  { value: "lastYear", label: "Last year" }, { value: "custom", label: "Custom range" },
];

/** The shared presets minus All Periods: this report returns every line in one
 *  response, so it needs a bounded window (the server refuses All Periods). */
export const ISD_PERIOD_OPTIONS = PERIOD_OPTIONS.filter((o) => o.value !== "allPeriods");

export const FBR_STATUS_OPTIONS = [
  { id: "submitted", name: "Submitted to FBR" },
  { id: "notSubmitted", name: "Not submitted to FBR" },
];

export const DEFAULT_PAGE_SIZE = 50;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const text = (v) => String(v ?? "").trim();

/** The API query for the applied filters. The screen and the Excel both send
 *  exactly this, so the workbook always holds the bills on screen. */
export function toApiParams(f) {
  const p = { period: f.period || "thisMonth" };
  if (p.period === "custom") {
    if (f.from) p.from = f.from;
    if (f.to) p.to = f.to;
  }
  if (text(f.search)) p.search = text(f.search);
  if (f.status) p.fbrStatus = f.status;
  if (f.clientId) p.clientId = f.clientId;
  return p;
}

/**
 * The report's lines grouped into bills, in the report's own order. The server
 * writes a bill's lines together, so a bill is its rows sharing one invoice id.
 */
export function groupBills(rows = []) {
  const byId = new Map();
  for (const r of rows) {
    let b = byId.get(r.invoiceId);
    if (!b) {
      b = {
        invoiceId: r.invoiceId, first: r, lines: [], cancelled: r.billStatus === "Cancelled",
        totals: { excl: 0, gst: 0, incl: 0, adv: 0, further: 0, total: 0 },
      };
      byId.set(r.invoiceId, b);
    }
    b.lines.push(r);
    const t = b.totals;
    t.excl = round2(t.excl + Number(r.excludingTax || 0));
    t.gst = round2(t.gst + Number(r.salesTax || 0));
    t.incl = round2(t.incl + Number(r.includingTax || 0));
    t.adv = round2(t.adv + Number(r.advanceTax || 0));
    t.further = round2(t.further + Number(r.furtherTax || 0));
    t.total = round2(t.total + Number(r.total || 0));
  }
  return [...byId.values()];
}

/** A column's sum over rows, to the paisa. */
export const sumOf = (rows = [], key) => round2(rows.reduce((s, r) => s + Number(r[key] || 0), 0));

/** One page of BILLS, so a bill is never split across two pages. */
export function pageOfBills(bills, page, pageSize) {
  const size = Math.max(1, pageSize || DEFAULT_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(bills.length / size));
  const p = Math.min(Math.max(1, page || 1), totalPages);
  const start = bills.length ? (p - 1) * size : 0;
  const slice = bills.slice(start, start + size);
  return { bills: slice, page: p, totalPages, firstIndex: start, lastIndex: start + slice.length };
}

const TILE_LABELS = {
  invoiceCount: "Bills", submittedCount: "Submitted", notSubmittedCount: "Not submitted",
  excludingTax: "Excl", salesTax: "G. S. T", advanceTax: "236-G / 236-H", furtherTax: "Further tax",
  total: "Total incl taxes",
};

/** The tiles: counts, then the money; advance and further tax only when charged. */
export function totalsFor(report) {
  const totals = {
    invoiceCount: report.invoiceCount, submittedCount: report.submittedCount,
    notSubmittedCount: report.notSubmittedCount, excludingTax: report.excludingTax,
    salesTax: report.salesTax,
  };
  if (Number(report.advanceTax)) totals.advanceTax = report.advanceTax;
  if (Number(report.furtherTax)) totals.furtherTax = report.furtherTax;
  totals.total = report.total;
  const notes = report.cancelledCount ? { invoiceCount: `${report.cancelledCount} cancelled` } : {};
  return { totals, totalLabels: TILE_LABELS, notes };
}

const TONES = {
  "submitted": "ok",
  "not submitted": "warn",
  "uncertain": "warn",
  "fbr cancelled": "bad",
  "failed": "bad",
  "submitting": "info",
  "validated": "info",
  "excluded from fbr": "muted",
};
/** The chip tone for an FBR status as the report words it. */
export const fbrTone = (status) => TONES[text(status).toLowerCase()] || "muted";

export function fmtQty(n) {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? v.toLocaleString("en-PK") : v.toLocaleString("en-PK", { maximumFractionDigits: 4 });
}

export function fmtRate(n) {
  const v = Number(n) || 0;
  return `${Number.isInteger(v) ? v : Math.round(v * 100) / 100}%`;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "01 Aug 2026", from the date alone — never through a Date, which would move
 *  a bill's day across a time zone. */
export function fmtDay(iso) {
  const s = String(iso || "");
  const [y, m, d] = s.slice(0, 10).split("-");
  return d && MON[Number(m) - 1] ? `${d} ${MON[Number(m) - 1]} ${y}` : s;
}

/** The workbook's name — the server's rule: a whole calendar month keeps the
 *  export's old name, any other range names its dates. */
export function excelFileName(report) {
  const from = String(report?.from || "").slice(0, 10);
  const to = String(report?.to || "").slice(0, 10);
  const [y, m, d] = from.split("-").map(Number);
  if (!y || !m || !d || !to) return "Invoice-Sales-Detail.xlsx";
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const wholeMonth = d === 1 && to === `${from.slice(0, 7)}-${String(last).padStart(2, "0")}`;
  return wholeMonth
    ? `Invoice-Sales-Detail-${from.slice(0, 7)}.xlsx`
    : `Invoice-Sales-Detail-${from}_to_${to}.xlsx`;
}

/** What an empty grid says. */
export function emptyText(report, f) {
  const where = report?.periodLabel ? ` in ${report.periodLabel}` : "";
  const filtered = !!(f.clientId || f.status || text(f.search));
  return filtered ? `No bills match these filters${where}.` : `No bills${where}.`;
}
