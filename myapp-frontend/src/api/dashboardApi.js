// src/api/dashboardApi.js
//
// Single-endpoint client for the home-page KPI aggregator. The backend
// returns ONLY the sections the caller has perm for — sales / purchases
// / fbr / inventory blocks are nullable on the wire — so the page
// renders permission-shaped without per-section round trips.
import httpClient from "./httpClient";

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
export async function getDashboardKpis(companyId, period = "this-month") {
  const { data } = await httpClient.get("/dashboard/kpis", {
    params: { companyId, period },
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
export async function getDashboardBreakdown(companyId, kind, period = "this-month") {
  const { data } = await httpClient.get("/dashboard/breakdown", {
    params: { companyId, kind, period },
    timeout: 60000,
  });
  return data;
}
