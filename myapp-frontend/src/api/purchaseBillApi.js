import http from "./httpClient";

export const getPurchaseBillsByCompanyPaged = (companyId, params = {}) =>
  http.get(`/purchasebills/company/${companyId}/paged`, { params });
export const getPurchaseBillById = (id) => http.get(`/purchasebills/${id}`);
export const createPurchaseBill = (payload) => http.post("/purchasebills", payload);
export const updatePurchaseBill = (id, payload) => http.put(`/purchasebills/${id}`, payload);
export const deletePurchaseBill = (id) => http.delete(`/purchasebills/${id}`);
export const getPurchaseBillsCount = (companyId) =>
  http.get("/purchasebills/count", { params: { companyId } });
