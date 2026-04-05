import http from "./httpClient";

export const getItemTypes = () => http.get("/itemtypes");
export const getItemTypeById = (id) => http.get(`/itemtypes/${id}`);
export const createItemType = (payload) => http.post("/itemtypes", payload);
export const updateItemType = (id, payload) => http.put(`/itemtypes/${id}`, payload);
export const deleteItemType = (id) => http.delete(`/itemtypes/${id}`);
