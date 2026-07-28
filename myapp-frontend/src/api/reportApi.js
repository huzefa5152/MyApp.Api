import http from "./httpClient";

// Sales report — FBR-submitted invoices grouped by document date.
// params: { year, month?, buyerType }  (month omitted = full year)
export const getSalesReport = (companyId, params = {}) =>
  http.get(`/reports/company/${companyId}/sales`, { params });

// Styled .xlsx download of the same report. Returns a Blob response.
export const getSalesReportExcel = (companyId, params = {}) =>
  http.get(`/reports/company/${companyId}/sales/excel`, { params, responseType: "blob" });

// Tax Sheet — invoice lines still missing a valid HS code.
// params: { year, month?, dateFrom?, dateTo?, clientId? }
export const getTaxSheet = (companyId, params = {}) =>
  http.get(`/reports/company/${companyId}/tax-sheet`, { params });

export const getTaxSheetExcel = (companyId, params = {}) =>
  http.get(`/reports/company/${companyId}/tax-sheet/excel`, { params, responseType: "blob" });

// Defer the still-unclassified invoices of a period to a new date (next month).
// body: { year?, month?, dateFrom?, dateTo?, clientId?, targetDate }
export const transferTaxSheet = (companyId, body) =>
  http.post(`/reports/company/${companyId}/tax-sheet/transfer`, body);

// Outstanding Ledger — per-client receivables (amount / paid / balance / status
// + settling receipts). params: { clientId?, status }  status = all|unpaid|paid
export const getOutstandingLedger = (companyId, params = {}) =>
  http.get(`/reports/company/${companyId}/outstanding`, { params });

export const getOutstandingLedgerExcel = (companyId, params = {}) =>
  http.get(`/reports/company/${companyId}/outstanding/excel`, { params, responseType: "blob" });
