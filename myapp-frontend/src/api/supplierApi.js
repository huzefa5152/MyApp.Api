import http from "./httpClient";

export const getSuppliers = () => http.get("/suppliers");
export const getSuppliersByCompany = (companyId) => http.get(`/suppliers/company/${companyId}`);
export const getSupplierById = (id) => http.get(`/suppliers/${id}`);
export const createSupplier = (payload) => http.post("/suppliers", payload);
export const updateSupplier = (id, payload) => http.put(`/suppliers/${id}`, payload);
export const deleteSupplier = (id) => http.delete(`/suppliers/${id}`);
export const getSuppliersCount = (companyId) =>
  http.get("/suppliers/count", { params: companyId ? { companyId } : {} });
