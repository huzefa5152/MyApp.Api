import http from "./httpClient";

export const getCompanies = () => http.get("/companies");
// The same read, asked at start-up alongside the sign-in check (utils/bootPrefetch).
// A stale saved token must fail quietly here, as the sign-in check itself does.
export const prefetchCompanies = () => http.get("/companies", { _skipAuthRedirect: true });
export const getCompanyById = (id) => http.get(`/companies/${id}`);
export const createCompany = (payload) => http.post("/companies", payload);
export const updateCompany = (id, payload) => http.put(`/companies/${id}`, payload);
export const deleteCompany = (id) => http.delete(`/companies/${id}`);
export const uploadCompanyLogo = (id, formData) =>
  http.post(`/companies/${id}/logo`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
