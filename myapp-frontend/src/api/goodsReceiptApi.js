import http from "./httpClient";

export const getGoodsReceiptsByCompanyPaged = (companyId, params = {}) =>
  http.get(`/goodsreceipts/company/${companyId}/paged`, { params });
export const getGoodsReceiptById = (id) => http.get(`/goodsreceipts/${id}`);
export const createGoodsReceipt = (payload) => http.post("/goodsreceipts", payload);
export const updateGoodsReceipt = (id, payload) => http.put(`/goodsreceipts/${id}`, payload);
export const deleteGoodsReceipt = (id) => http.delete(`/goodsreceipts/${id}`);
