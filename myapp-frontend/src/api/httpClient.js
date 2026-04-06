// src/api/httpClient.js
import axios from "axios";
import { notify } from "../utils/notify";

function getApiBase() {
  // runtime file (preferred)
  if (typeof window !== "undefined" && window._env_ && window._env_.API_URL) {
    return window._env_.API_URL;
  }

  // Vite build-time env fallback
  if (import.meta && import.meta.env && import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }

  // last fallback: relative path (useful if serving frontend from same domain as API)
  return "/api";
}

const httpClient = axios.create({
  baseURL: getApiBase(),
  headers: { "Content-Type": "application/json" },
  withCredentials: false,
});

// Request interceptor: attach Bearer token from localStorage
httpClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor: handle errors globally
httpClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;

    if (status === 401 && window.location.pathname !== "/login") {
      localStorage.removeItem("token");
      window.location.href = "/login";
    } else if (status === 403) {
      notify("You don't have permission to perform this action.", "warning");
    } else if (status >= 500) {
      notify("Something went wrong on the server. Please try again.", "error");
    } else if (!error.response) {
      notify("Network error. Please check your connection.", "error");
    }

    return Promise.reject(error);
  }
);

export default httpClient;
