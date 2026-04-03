// src/api/authApi.js
import httpClient from "./httpClient";

export const loginApi = (username, password) =>
  httpClient.post("/auth/login", { username, password });

export const getCurrentUser = () => httpClient.get("/auth/me");

export const updateProfile = (data) => httpClient.put("/auth/profile", data);

export const changePassword = (data) => httpClient.put("/auth/password", data);

export const uploadAvatar = (file) => {
  const form = new FormData();
  form.append("file", file);
  return httpClient.post("/auth/avatar", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};
