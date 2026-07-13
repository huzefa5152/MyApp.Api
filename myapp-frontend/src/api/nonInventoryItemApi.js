import http from "./httpClient";

// Non-Inventory Items — per-company GL-account shortcut line items (Freight,
// Discount, service fees). No stock, no FBR. Each maps to the company's chart
// of accounts (sale + purchase account). Mirrors Manager.io's Non-inventory Items.

export const getNonInventoryItemsByCompany = (companyId, activeOnly = false) =>
  http.get(`/noninventoryitems/company/${companyId}`, { params: { activeOnly } });

export const getNonInventoryItemById = (id) =>
  http.get(`/noninventoryitems/${id}`);

// Payload: { name, code?, unitName?, saleAccountId?, purchaseAccountId?,
//            defaultLineDescription?, defaultSalePrice?, defaultPurchasePrice?,
//            hideNameOnPrint?, isActive }
export const createNonInventoryItem = (companyId, payload) =>
  http.post(`/noninventoryitems/company/${companyId}`, payload);

export const updateNonInventoryItem = (id, payload) =>
  http.put(`/noninventoryitems/${id}`, payload);

export const deleteNonInventoryItem = (id) =>
  http.delete(`/noninventoryitems/${id}`);
