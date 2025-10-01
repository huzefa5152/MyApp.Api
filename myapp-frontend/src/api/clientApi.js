import http from "./httpClient";

export const getClients = () => http.get("/clients");
export const getClientById = (id) => http.get(`/clients/${id}`);
export const createClient = (payload) => http.post("/clients", payload);
export const updateClient = (id, payload) => http.put(`/clients/${id}`, payload);
export const deleteClient = (id) => http.delete(`/clients/${id}`);
