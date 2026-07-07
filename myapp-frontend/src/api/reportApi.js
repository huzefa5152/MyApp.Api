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
