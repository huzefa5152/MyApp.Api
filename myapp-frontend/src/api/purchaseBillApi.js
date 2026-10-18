import http from "./httpClient";

export const previewPurchaseStock = (payload) => http.post("/purchasebills/stock-preview", payload);

export const getPurchaseBillsByCompanyPaged = (companyId, params = {}) =>
  http.get(`/purchasebills/company/${companyId}/paged`, { params });
export const getPurchaseBillById = (id) => http.get(`/purchasebills/${id}`);
export const getLocalPurchaseSources = (companyId, search) => http.get(`/purchasebills/company/${companyId}/local-purchase-sources`, { params: { search } });
export const getLocalPurchaseSource = (companyId, kind, id) => http.get(`/purchasebills/company/${companyId}/local-purchase-sources/${kind}/${id}`);
export const getPurchaseBillPrintData = (id) => http.get(`/purchasebills/${id}/print`);
export const createPurchaseBill = (payload) => http.post("/purchasebills", payload);
export const updatePurchaseBill = (id, payload) => http.put(`/purchasebills/${id}`, payload);
export const deletePurchaseBill = (id) => http.delete(`/purchasebills/${id}`);
export const getPurchaseBillsCount = (companyId) =>
  http.get("/purchasebills/count", { params: { companyId } });
export const createPurchaseBillsFromChallan = (challanId, settings) => http.post(`/purchasebills/from-challan/${challanId}`, settings);
export const previewPurchaseBillsFromChallan = (challanId) => http.get(`/purchasebills/from-challan/${challanId}/preview`);
