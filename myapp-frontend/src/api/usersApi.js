import httpClient from "./httpClient";

export const getUsers = () => httpClient.get("/users");

export const getUser = (id) => httpClient.get(`/users/${id}`);

export const createUser = (data) => httpClient.post("/users", data);

export const updateUser = (id, data) => httpClient.put(`/users/${id}`, data);

export const deleteUser = (id) => httpClient.delete(`/users/${id}`);
