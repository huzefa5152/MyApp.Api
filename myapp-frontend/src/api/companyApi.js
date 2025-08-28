import http from "./httpClient";

export const getCompanies = () => http.get("/companies");
export const getCompanyById = (id) => http.get(`/companies/${id}`);
export const createCompany = (payload) => http.post("/companies", payload);
export const updateCompany = (id, payload) => http.put(`/companies/${id}`, payload);
export const deleteCompany = (id) => http.delete(`/companies/${id}`);

export const getDeliveryChallansByCompany = (companyId) =>
  http.get(`/deliverychallans/company/${companyId}`);

export const createDeliveryChallan = (companyId, payload) =>
  http.post(`/deliverychallans/company/${companyId}`, payload);
