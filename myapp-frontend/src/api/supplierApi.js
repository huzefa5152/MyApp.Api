import http from "./httpClient";

export const getSuppliers = () => http.get("/suppliers");
export const getSuppliersByCompany = (companyId) => http.get(`/suppliers/company/${companyId}`);
export const getSupplierById = (id) => http.get(`/suppliers/${id}`);
export const createSupplier = (payload) => http.post("/suppliers", payload);
export const updateSupplier = (id, payload) => http.put(`/suppliers/${id}`, payload);
export const deleteSupplier = (id) => http.delete(`/suppliers/${id}`);
export const getSuppliersCount = (companyId) =>
  http.get("/suppliers/count", { params: companyId ? { companyId } : {} });

// Common Suppliers (group view) — mirror of the client-side helpers.
// Multi-company duplicates collapsed into a single editable record.
// Single-company suppliers DO NOT appear here; they keep working
// through the per-company endpoints above.
export const getCommonSuppliers = (companyId) =>
  http.get("/suppliers/common", { params: { companyId } });
export const getAllSupplierGroups = () => http.get("/suppliers/groups");
export const getCommonSupplierById = (groupId) =>
  http.get(`/suppliers/common/${groupId}`);
export const updateCommonSupplier = (groupId, payload) =>
  http.put(`/suppliers/common/${groupId}`, payload);
export const deleteCommonSupplier = (groupId) =>
  http.delete(`/suppliers/common/${groupId}`);
// Multi-company create: { ...supplierFields, companyIds: [1, 2] }
export const createSupplierBatch = (payload) =>
  http.post("/suppliers/batch", payload);
