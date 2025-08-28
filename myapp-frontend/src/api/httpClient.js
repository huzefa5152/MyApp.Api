// src/api/httpClient.js
import axios from "axios";

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

export default httpClient;
