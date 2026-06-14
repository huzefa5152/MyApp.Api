import httpClient from "./httpClient";

export const getPagedSalesOrdersByCompany = (companyId, params = {}) =>
  httpClient.get(`/salesorders/company/${companyId}/paged`, { params });

// Open orders with quantity still to deliver — powers the challan picker.
export const getOpenSalesOrdersByCompany = (companyId) =>
  httpClient.get(`/salesorders/company/${companyId}/open`);

export const getSalesOrderById = (id) =>
  httpClient.get(`/salesorders/${id}`);

export const createSalesOrder = (companyId, payload) =>
  httpClient.post(`/salesorders/company/${companyId}`, payload);

export const updateSalesOrder = (id, payload) =>
  httpClient.put(`/salesorders/${id}`, payload);

export const setSalesOrderStatus = (id, status) =>
  httpClient.put(`/salesorders/${id}/status`, { status });

// Create a delivery challan fulfilling this order. Body:
// { deliveryDate, site, lines: [{ salesOrderItemId, quantity }] } — empty
// lines means "deliver the remaining quantity of every line".
export const createChallanFromOrder = (id, payload) =>
  httpClient.post(`/salesorders/${id}/create-challan`, payload);

export const deleteSalesOrder = (id) =>
  httpClient.delete(`/salesorders/${id}`);

export const getSalesOrderPrintData = (id) =>
  httpClient.get(`/salesorders/${id}/print`);

// Delivery challans raised against this order — powers the View drill-down.
export const getSalesOrderChallans = (id) =>
  httpClient.get(`/salesorders/${id}/challans`);

export const getSalesOrdersCount = (companyId) =>
  httpClient.get("/salesorders/count", { params: companyId ? { companyId } : {} });
