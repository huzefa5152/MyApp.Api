// src/api/dashboardApi.js
//
// Single-endpoint client for the home-page KPI aggregator. The backend
// returns ONLY the sections the caller has perm for — sales / purchases
// / fbr / inventory blocks are nullable on the wire — so the page
// renders permission-shaped without per-section round trips.
import httpClient from "./httpClient";

/**
 * Accepts the old positional period string OR `{ period, from, to, groupKey }`.
 * `from`/`to` (yyyy-MM-dd, inclusive) override `period` on the server.
 */
function periodParams(arg) {
  const o = typeof arg === "string" || arg == null ? { period: arg || "this-month" } : arg;
  const p = { period: o.period || "this-month" };
  if (o.from && o.to) { p.from = o.from; p.to = o.to; }
  if (o.groupKey) p.groupKey = o.groupKey;
  return p;
}

/**
 * GET /api/dashboard/kpis?companyId=X&period=this-month
 *
 * `period` accepts:
 *   this-week | last-week | this-month | last-month |
 *   this-year | last-year | all-time
 *
 * Returns the DashboardKpisResponse shape (see DashboardDtos.cs).
 * Throws on 4xx/5xx — caller wraps in try/catch.
 */
export async function getDashboardKpis(companyId, periodOrOptions = "this-month") {
  const { data } = await httpClient.get("/dashboard/kpis", {
    params: { companyId, ...periodParams(periodOrOptions) },
    timeout: 30000,
  });
  return data;
}

/**
 * GET /api/dashboard/breakdown?companyId=X&kind=dead-stock&period=all-time
 *
 * The rows behind one KPI. They sum to exactly what that card shows, because
 * the server computes both from the same walk rather than twice.
 *
 * Kinds: sales | cogs | cogs-landed | real-margin | stock-on-hand |
 *        dead-stock | stock-converted | stock-ageing | unrealised-margin |
 *        inventory-adjustments | receivables | payables | recoverable-tax |
 *        import-book | duty-burden
 */
export async function getDashboardBreakdown(companyId, kind, periodOrOptions = "this-month") {
  const { data } = await httpClient.get("/dashboard/breakdown", {
    params: { companyId, kind, ...periodParams(periodOrOptions) },
    timeout: 60000,
  });
  return data;
}
