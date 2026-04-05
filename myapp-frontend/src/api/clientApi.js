import http from "./httpClient";

export const getClients = () => http.get("/clients");
export const getClientsByCompany = (companyId) => http.get(`/clients/company/${companyId}`);
export const getClientById = (id) => http.get(`/clients/${id}`);
export const createClient = (payload) => http.post("/clients", payload);
export const updateClient = (id, payload) => http.put(`/clients/${id}`, payload);
export const deleteClient = (id) => http.delete(`/clients/${id}`);
export const getClientsCount = (companyId) =>
  http.get("/clients/count", { params: companyId ? { companyId } : {} });
