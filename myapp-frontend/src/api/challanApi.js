import httpClient from "./httpClient";

export const getDeliveryChallansByCompany = (companyId) =>
  httpClient.get(`/deliverychallans/company/${companyId}`);

export const getPagedChallansByCompany = (companyId, params = {}) =>
  httpClient.get(`/deliverychallans/company/${companyId}/paged`, { params });

export const getPendingChallansByCompany = (companyId) =>
  httpClient.get(`/deliverychallans/company/${companyId}/pending`);

export const getDeliveryChallanById = (id) =>
  httpClient.get(`/deliverychallans/${id}`);

export const createDeliveryChallan = (companyId, payload) =>
  httpClient.post(`/deliverychallans/company/${companyId}`, payload);

export const updateChallanItems = (challanId, items) =>
  httpClient.put(`/deliverychallans/${challanId}/items`, items);

export const updateChallanPo = (challanId, payload) =>
  httpClient.put(`/deliverychallans/${challanId}/po`, payload);

export const cancelChallan = (challanId) =>
  httpClient.put(`/deliverychallans/${challanId}/cancel`);

export const deleteChallan = (challanId) =>
  httpClient.delete(`/deliverychallans/${challanId}`);

export const deleteChallanItem = (itemId) =>
  httpClient.delete(`/deliverychallans/items/${itemId}`);

export const getChallanPrintData = (challanId) =>
  httpClient.get(`/deliverychallans/${challanId}/print`);

export const getDeliveryChallansCount = (companyId) =>
  httpClient.get("/deliverychallans/count", { params: companyId ? { companyId } : {} });
