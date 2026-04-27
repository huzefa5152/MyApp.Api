import http from "./httpClient";

export const getItemTypes = () => http.get("/itemtypes");
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
