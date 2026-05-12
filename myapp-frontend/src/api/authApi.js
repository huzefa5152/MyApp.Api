// src/api/authApi.js
import httpClient from "./httpClient";

export const loginApi = (username, password) =>
  httpClient.post("/auth/login", { username, password });

// `silent`: when true, the httpClient 401 interceptor will NOT bounce
// the user to /login + save a postLoginReturnTo. Used by the
// AuthContext mount-time probe (we want to validate the stored token
// quietly — if it's stale, just clear it and let whatever public route
// the user is on render normally). Without this flag, opening the
// landing page `/` with a stale token would save postLoginReturnTo=`/`
// and the next successful login would drop the operator on the public
// site instead of /dashboard. 2026-05-12.
export const getCurrentUser = ({ silent = false } = {}) =>
  httpClient.get("/auth/me", silent ? { _skipAuthRedirect: true } : undefined);

export const updateProfile = (data) => httpClient.put("/auth/profile", data);

export const changePassword = (data) => httpClient.put("/auth/password", data);

export const uploadAvatar = (file) => {
  const form = new FormData();
  form.append("file", file);
  return httpClient.post("/auth/avatar", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};

export const removeAvatar = () => httpClient.delete("/auth/avatar");
