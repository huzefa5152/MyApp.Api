import http from "./httpClient";

// Optional companyId (2026-05-12): when supplied, the backend returns
// per-company AvailableQty on each row and sorts the list so items
// with available stock surface first. Pass it from sales-side
// dropdowns (Edit Bill, Generate Bill from Challan, Standalone Bill);
// admin pages can call without it for the legacy alpha sort.
export const getItemTypes = (companyId) =>
  http.get("/itemtypes", { params: companyId ? { companyId } : {} });
export const getItemTypeById = (id) => http.get(`/itemtypes/${id}`);
export const createItemType = (payload, companyId) =>
  http.post("/itemtypes", payload, { params: companyId ? { companyId } : {} });
export const updateItemType = (id, payload, companyId) =>
  http.put(`/itemtypes/${id}`, payload, { params: companyId ? { companyId } : {} });
export const deleteItemType = (id) => http.delete(`/itemtypes/${id}`);

// One-shot suggestion endpoint — returns valid UOMs, default UOM,
// suggested sale type + rate, and live FBR rate options for an HS Code.
export const getItemTypeFbrHints = (companyId, hsCode) =>
  http.get("/itemtypes/fbr-hints", { params: { companyId, hsCode } });
