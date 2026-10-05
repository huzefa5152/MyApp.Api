import http from "./httpClient";

// Purchases -> Import Tax Desk (Controllers/ImportTaxController.cs and the
// tie-out on StockController). All read-only; months are "yyyy-MM".

export const getInputTaxWorksheet = (companyId, from, to) =>
  http.get(`/import-tax/company/${companyId}/input-tax`, { params: { from, to } });

export const exportInputTaxWorksheet = (companyId, from, to) =>
  http.get(`/import-tax/company/${companyId}/input-tax/excel`, { params: { from, to }, responseType: "blob" });

export const getGdRegister = (companyId, { from, to, unclaimedOnly } = {}) =>
  http.get(`/import-tax/company/${companyId}/gd-register`, {
    params: { ...(from ? { from } : {}), ...(to ? { to } : {}), ...(unclaimedOnly ? { unclaimedOnly: true } : {}) },
  });

export const exportGdRegister = (companyId, { from, to, unclaimedOnly } = {}) =>
  http.get(`/import-tax/company/${companyId}/gd-register/excel`, {
    params: { ...(from ? { from } : {}), ...(to ? { to } : {}), ...(unclaimedOnly ? { unclaimedOnly: true } : {}) },
    responseType: "blob",
  });

export const getStockTieOut = (companyId, month) =>
  http.get(`/stock/company/${companyId}/tie-out`, { params: { month }, timeout: 300000 });
