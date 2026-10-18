// Pure: the Accounting page's period, drill figures and chart series.
// No React, so node can test it (scripts/test_dashboard_ui.mjs).
import { monthLabel } from "./overviewData.js";

const ymd = (d) => d.toISOString().slice(0, 10);
const utc = (y, m, d) => new Date(Date.UTC(y, m, d));

// A header preset as the inclusive from/to the summary endpoint takes, cut the
// way the server's DashboardService.BuildPeriod cuts it (weeks start Monday).
// today = Pakistan "yyyy-MM-dd". All time starts at 2000-01-01.
export function presetRange(period, today, custom = {}) {
  const [y, m, d] = String(today).split("-").map(Number);
  const t = utc(y, m - 1, d);
  const dow = (t.getUTCDay() + 6) % 7; // Monday = 0
  const monday = utc(y, m - 1, d - dow);
  const day = (base, n) => new Date(base.getTime() + n * 86400000);
  switch (period) {
    case "this-week": return { from: ymd(monday), to: ymd(day(monday, 6)) };
    case "last-week": return { from: ymd(day(monday, -7)), to: ymd(day(monday, -1)) };
    case "this-month": return { from: ymd(utc(y, m - 1, 1)), to: ymd(utc(y, m, 0)) };
    case "last-month": return { from: ymd(utc(y, m - 2, 1)), to: ymd(utc(y, m - 1, 0)) };
    case "this-year": return { from: `${y}-01-01`, to: `${y}-12-31` };
    case "last-year": return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    case "all-time": return { from: "2000-01-01", to: today };
    case "custom": return custom.from && custom.to ? { from: custom.from, to: custom.to } : null;
    default: return null;
  }
}

// The figure each drill must add up to: the tile that opened it. Only tiles
// whose breakdown totals exactly their figure are drillable on this page, so
// kinds missing here have no drill. A drill restored for another window
// (Back after the page period changed) has no card figure.
export function accountingCardValue(drill, { summary, tax, range } = {}) {
  if (!drill?.kind || !summary) return null;
  if (range && (drill.from !== range.from || drill.to !== range.to)) return null;
  const s = summary;
  const byKind = {
    receivables: s.receivables?.total,
    "recoverable-tax": s.recoverableTax,
    "unrealised-margin": s.unrealisedMargin,
    "import-book": s.importLandedCost,
    "duty-burden": (Number(s.importInputTax) || 0) + (Number(s.importIncomeTax) || 0),
    "tax-payable": tax?.totalPayable,
  };
  return byKind[drill.kind] ?? null;
}

// The largest customer balances from the receivables breakdown's level 1 (the
// aged report's customers). Money held on account (negative) is not a balance owed.
// No age buckets: receipts are taken on account, so buckets misread (CLAUDE.md 5b-8).
export function topBalances(rows, n = 10) {
  return (rows || [])
    .map((r) => ({ label: r.label || "(unknown)", value: Number(r.amount) || 0, groupKey: r.groupKey || null }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

export function cashSeries(monthly) {
  return (monthly || []).map((m) => ({ month: m.month, label: monthLabel(m.month), cashIn: Number(m.cashIn) || 0, cashOut: Number(m.cashOut) || 0 }));
}

export function profitSeries(monthly) {
  return (monthly || []).map((m) => ({
    month: m.month, label: monthLabel(m.month),
    income: Number(m.income) || 0, expense: Number(m.expense) || 0, netProfit: Number(m.netProfit) || 0,
  }));
}
