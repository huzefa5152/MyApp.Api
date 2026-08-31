import httpClient from "./httpClient";

// Customer Ledger — read-only. Nothing here writes: every figure is DERIVED
// live by CustomerLedgerService from invoices, credit/debit notes, receipts
// and their allocations, so there is nothing to create/update/delete.
//
// COLUMN CONVENTION (user decision, 2026-08-30) — this follows the operator's
// own workbook, which is the MIRROR of textbook A/R:
//   • Invoice / Debit Note                → Credit
//   • Receipt / Credit Note / Adjustment  → Debit
//   • Balance = Opening + Σ Credit − Σ Debit
// A POSITIVE balance means the customer owes us; NEGATIVE means they hold an
// advance. The API already returns figures this way — RENDER WHAT IT RETURNS.
// Never re-derive, negate or swap columns on the client.

/**
 * Per-customer aggregates for one company → CustomerLedgerRowDto[].
 * Rolled up by ClientGroupId ?? -ClientId (same identity the dashboard uses),
 * ordered by closing balance descending — biggest debtor first. Not paged.
 *
 * @param params { from?, to? } — ISO dates. `from` also decides the Opening
 *   figure: with no `from` the window is all of history, so Opening is 0.
 */
export const getCustomerLedgerSummary = (companyId, params = {}) =>
  httpClient.get(`/customer-ledger/company/${companyId}`, { params });

/**
 * One customer's chronological trail → CustomerLedgerDto (newest-first, paged).
 * The client id is resolved INSIDE the company scope server-side, so an id
 * from another company 404s exactly like an unknown one.
 *
 * @param params { from?, to?, type?, page?, pageSize? }
 *   `type` is an exact (case-insensitive) match on the entry Type —
 *   "Invoice" | "Debit Note" | "Credit Note" | "Receipt" | "Adjustment".
 *   It HIDES rows only: running balances, Opening/Closing and the Credit/Debit
 *   totals are always computed over the whole window first.
 *   pageSize defaults to 50 server-side and is clamped at 200.
 *
 * There is deliberately no `method` parameter — the API does not offer one.
 * The page filters by payment method on the loaded page (see CustomerLedgerPage).
 */
export const getCustomerLedgerEntries = (companyId, clientId, params = {}) =>
  httpClient.get(`/customer-ledger/company/${companyId}/client/${clientId}`, { params });
