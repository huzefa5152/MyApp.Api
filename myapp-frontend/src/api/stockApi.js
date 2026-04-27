import http from "./httpClient";

export const getStockOnHand = (companyId) =>
  http.get(`/stock/company/${companyId}/onhand`);
export const getStockMovements = (companyId, params = {}) =>
  http.get(`/stock/company/${companyId}/movements`, { params });
export const getOpeningBalances = (companyId) =>
  http.get(`/stock/company/${companyId}/opening`);
export const upsertOpeningBalance = (payload) =>
  http.post("/stock/opening", payload);
export const deleteOpeningBalance = (id) =>
  http.delete(`/stock/opening/${id}`);
export const adjustStock = (payload) =>
  http.post("/stock/adjust", payload);
