import httpClient from "./httpClient";

export const getPagedSalesQuotesByCompany = (companyId, params = {}) =>
  httpClient.get(`/salesquotes/company/${companyId}/paged`, { params });

export const getSalesQuoteById = (id) =>
  httpClient.get(`/salesquotes/${id}`);

export const createSalesQuote = (companyId, payload) =>
  httpClient.post(`/salesquotes/company/${companyId}`, payload);

export const updateSalesQuote = (id, payload) =>
  httpClient.put(`/salesquotes/${id}`, payload);

export const setSalesQuoteStatus = (id, status) =>
  httpClient.put(`/salesquotes/${id}/status`, { status });

// Convert an accepted quote into a (quantity-only) Sales Order.
export const convertQuoteToOrder = (id) =>
  httpClient.post(`/salesquotes/${id}/convert-to-order`);

export const deleteSalesQuote = (id) =>
  httpClient.delete(`/salesquotes/${id}`);

export const getSalesQuotePrintData = (id) =>
  httpClient.get(`/salesquotes/${id}/print`);

// Last billed unit price for an item — used to pre-fill the quote line price
// when the item already exists in the system.
export const getQuoteItemRate = (companyId, { description, itemTypeId } = {}) =>
  httpClient.get(`/salesquotes/company/${companyId}/item-rate`, {
    params: { description: description || undefined, itemTypeId: itemTypeId || undefined },
  });

export const getSalesQuotesCount = (companyId) =>
  httpClient.get("/salesquotes/count", { params: companyId ? { companyId } : {} });
