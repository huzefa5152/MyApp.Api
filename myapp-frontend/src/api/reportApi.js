import http from "./httpClient";

// Sales report — FBR-submitted invoices grouped by document date.
// params: { year, month?, buyerType }  (month omitted = full year)
export const getSalesReport = (companyId, params = {}) =>
  http.get(`/reports/company/${companyId}/sales`, { params });

// Styled .xlsx download of the same report. Returns a Blob response.
export const getSalesReportExcel = (companyId, params = {}) =>
  http.get(`/reports/company/${companyId}/sales/excel`, { params, responseType: "blob" });

// Tax Sheet — invoice lines still missing a valid HS code.
// params: { year, month?, dateFrom?, dateTo? }
export const getTaxSheet = (companyId, params = {}) =>
  http.get(`/reports/company/${companyId}/tax-sheet`, { params });

export const getTaxSheetExcel = (companyId, params = {}) =>
  http.get(`/reports/company/${companyId}/tax-sheet/excel`, { params, responseType: "blob" });

// Client Ledger — every customer's statement for the period (opening balance,
// full trail with a running balance, closing balance), composed from the same
// customer-ledger service the Accounting screen uses.
// params: { year, month?, dateFrom?, dateTo?, clientId? }  (clientId omitted = all customers)
export const getClientLedgerReport = (companyId, params = {}) =>
  http.get(`/reports/company/${companyId}/client-ledger`, { params });

// Styled .xlsx of the same report: a Summary sheet plus one sheet per customer.
export const getClientLedgerReportExcel = (companyId, params = {}) =>
  http.get(`/reports/company/${companyId}/client-ledger/excel`, { params, responseType: "blob" });

// Options for the report's customer filter — [{ id, name }] and nothing else.
// Deliberately NOT /clients/company/{id}: that feed returns the full client
// record (address, phone, email, NTN, STRN, CNIC), so pointing the picker at it
// would mean granting every report viewer the company's customer PII.
export const getClientLedgerCustomers = (companyId) =>
  http.get(`/reports/company/${companyId}/client-ledger/customers`);
