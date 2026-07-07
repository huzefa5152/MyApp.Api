import http from "./httpClient";

export const getStockOnHand = (companyId) =>
  http.get(`/stock/company/${companyId}/onhand`);
// V2 derived inventory summary: OnHand / Committed / ToDeliver / Delivered /
// Available / Incoming per item type, computed live from documents.
export const getInventorySummary = (companyId) =>
  http.get(`/stock/company/${companyId}/summary`);
// Switch a company's inventory tracking version (1 = legacy HS-gated, 2 =
// standard inventory). Reversible + audited; gated by stock.policy.manage.
export const setInventoryFlowVersion = (companyId, version) =>
  http.post(`/stock/company/${companyId}/flow-version`, { version });
// Per-company item policy override: mode 0=default, 1=force-tracked,
// 2=FBR-only (excluded from inventory) + optional reorder level.
export const setItemTypePolicy = (companyId, itemTypeId, mode, reorderLevel = null) =>
  http.post(`/stock/company/${companyId}/itemtype-policy`, { itemTypeId, mode, reorderLevel });
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
