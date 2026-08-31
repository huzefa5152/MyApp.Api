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
 * One CUSTOMER's chronological trail → CustomerLedgerDto (newest-first, paged).
 *
 * Note the route: `/customer/`, NOT `/client/`. The summary above rolls its rows
 * up by `ClientGroupId ?? -ClientId`, so a company holding two records for the
 * same legal entity shows ONE row carrying BOTH records' figures. This route
 * resolves the same group, so the trail always adds up to the row it is opened
 * under. The `/client/` route reports a single client record and is what
 * ClientService.GetStatementAsync and the Client Ledger report use — do not
 * swap one for the other.
 *
 * The client id is resolved INSIDE the company scope server-side, so an id from
 * another company 404s exactly like an unknown one.
 *
 * @param params { from?, to?, type?, method?, page?, pageSize? }
 *   `type` is an exact (case-insensitive) match on the entry Type —
 *   "Invoice" | "Debit Note" | "Credit Note" | "Receipt" | "Adjustment".
 *   `method` matches CustomerLedgerEntryDto.Method and applies to receipts only.
 *   Both HIDE rows: running balances, Opening/Closing and the Credit/Debit
 *   totals are computed over the whole window before either runs, and `total`
 *   counts what survives both — so paging always matches what is displayed.
 *   pageSize defaults to 50 server-side and is clamped at 200.
 */
export const getCustomerLedgerEntries = (companyId, clientId, params = {}) =>
  httpClient.get(`/customer-ledger/company/${companyId}/customer/${clientId}`, { params });
