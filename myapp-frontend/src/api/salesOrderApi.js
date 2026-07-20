import httpClient from "./httpClient";

export const getPagedSalesOrdersByCompany = (companyId, params = {}) =>
  httpClient.get(`/salesorders/company/${companyId}/paged`, { params });

// Picker helper: the paged endpoint clamps pageSize at 100 server-side, so a
// single oversized request silently truncates larger companies. Walk pages
// (bounded) and return a flat item array.
export const getSalesOrdersForPicker = async (companyId, params = {}, maxPages = 5) => {
  const items = [];
  for (let page = 1; page <= maxPages; page++) {
    const { data } = await getPagedSalesOrdersByCompany(companyId, { ...params, page, pageSize: 100 });
    items.push(...(data?.items || []));
    const total = data?.totalCount ?? items.length;
    if (!data?.items?.length || items.length >= total) break;
  }
  return items;
};

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

// Prefill for "create a bill from this order" (FBR-off standalone billing).
// Returns header (client, PO, site) + lines with unit prices resolved
// server-side: source-quote price → last billed rate → 0.
export const getSalesOrderInvoicePrefill = (id) =>
  httpClient.get(`/salesorders/${id}/invoice-prefill`);

export const getSalesOrderPrintData = (id) =>
  httpClient.get(`/salesorders/${id}/print`);

// Delivery challans raised against this order — powers the View drill-down.
export const getSalesOrderChallans = (id) =>
  httpClient.get(`/salesorders/${id}/challans`);

export const getSalesOrdersCount = (companyId) =>
  httpClient.get("/salesorders/count", { params: companyId ? { companyId } : {} });
