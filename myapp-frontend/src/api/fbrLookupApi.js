import http from "./httpClient";

export const getFbrLookups = () => http.get("/FbrLookup");
export const getFbrLookupsByCategory = (category) => http.get(`/FbrLookup/category/${category}`);
export const createFbrLookup = (data) => http.post("/FbrLookup", data);
export const updateFbrLookup = (id, data) => http.put(`/FbrLookup/${id}`, data);
export const deleteFbrLookup = (id) => http.delete(`/FbrLookup/${id}`);
