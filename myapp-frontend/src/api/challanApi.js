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

// Full-field challan update: client, site, delivery date, PO number (clearable),
// PO date, and items — in a single request. Empty/blank PO number transitions
// the challan to "No PO" status; populated PO number → "Pending".
export const updateChallan = (challanId, payload) =>
  httpClient.put(`/deliverychallans/${challanId}`, payload);

// Clone a Pending/Imported challan as N new rows reusing the same ChallanNumber.
// Returns the new challan with `duplicatedFromId` populated. Use this when one
// delivery covers multiple POs and each PO needs its own bill — the operator
// then edits the PO/items in the next step before saving.
//
// 2026-05-08: count parameter added so the operator can request "create N copies"
// in one round-trip instead of clicking Duplicate N times. Server caps count at
// 20. When count == 1 the response is the single clone (back-compat); when
// count > 1 the response is an array of clones.
export const duplicateChallan = (challanId, count = 1) =>
  httpClient.post(`/deliverychallans/${challanId}/duplicate`, null, {
    params: { count },
  });

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
