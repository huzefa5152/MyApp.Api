// Pure: what the Overview page's tiles and charts show, and what each drill's
// card figure is. No React, so node can test it (scripts/test_dashboard_ui.mjs).

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-05" -> "May 26"
export function monthLabel(ym) {
  const [y, m] = String(ym || "").split("-").map(Number);
  if (!y || !m) return String(ym || "");
  return `${MONTHS[m - 1]} ${String(y).slice(2)}`;
}

export const ageingTotal = (hero) =>
  (Number(hero?.stockAgeUnder30) || 0) + (Number(hero?.stockAge30To90) || 0) + (Number(hero?.stockAgeOver90) || 0);

// The figure a drill's level 1 must add up to: the card (or chart) that opened it.
// A drill opened on its own window (a chart month outside the page's period) has
// no card figure: null, so the panel shows its own total.
export function drillCardValue(drill, { hero, health, tax } = {}) {
  if (!drill?.kind || drill.period) return null;
  const h = hero || {};
  const byKind = {
    sales: h.netSales,
    "margin-landed": h.grossMarginLanded,
    "cogs-landed": h.landedCostOfSales,
    receivables: h.receivablesScopeRestricted ? null : h.receivablesTotal,
    payables: h.payablesTotal,
    "recoverable-tax": h.recoverableTaxTotal,
    "stock-on-hand": h.stockOnHandValue,
    "dead-stock": h.deadStockValue,
    "stock-converted": h.stockConvertedValue,
    "stock-ageing": hero ? ageingTotal(h) : null,
    "tax-payable": tax?.totalPayable,
  };
  if (drill.kind in byKind) return byKind[drill.kind] ?? null;
  return (health || []).find((x) => x.key === drill.kind)?.amount ?? null;
}

export function monthlySeries(monthly) {
  return (monthly || []).map((m) => ({
    month: m.month, label: monthLabel(m.month),
    netSales: Number(m.netSales) || 0, landedCost: Number(m.landedCost) || 0,
    marginPct: m.marginPct == null ? null : Number(m.marginPct),
  }));
}

// Input tax reduces what is payable, so it stacks below the axis.
export function taxMonthSeries(months) {
  return (months || []).map((m) => ({
    month: m.month, label: monthLabel(m.month),
    output: Number(m.outputTax) || 0, further: Number(m.furtherTax) || 0,
    adv236: Number(m.adv236) || 0, input: -(Number(m.inputTax) || 0),
  }));
}

// Net sales (excl. tax) — the figure the sales drill adds up; groupKey opens that customer.
export function topCustomers(topClients, n = 10) {
  return (topClients || []).slice(0, n).map((c) => ({
    id: c.id, label: c.name || "(unknown)", value: Number(c.netValue ?? c.value) || 0, groupKey: c.groupKey || null,
  }));
}

// "2026-05" -> { from: "2026-05-01", to: "2026-05-31" } (inclusive, as the API takes it).
export function monthRange(ym) {
  const [y, m] = String(ym || "").split("-").map(Number);
  if (!y || !m) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` };
}

export function ageingSeries(hero) {
  return [{
    label: "Stock held",
    under30: Number(hero?.stockAgeUnder30) || 0,
    d30to90: Number(hero?.stockAge30To90) || 0,
    over90: Number(hero?.stockAgeOver90) || 0,
  }];
}

export const hasAny = (rows, keys) => (rows || []).some((r) => keys.some((k) => Number(r[k]) !== 0 && r[k] != null));
