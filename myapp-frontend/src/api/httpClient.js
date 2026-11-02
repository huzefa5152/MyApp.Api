// src/api/httpClient.js
import axios from "axios";
import { installServiceContinuity } from "../utils/serviceContinuity";
import { sameSession } from "../utils/sessionIdentity";
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

// Before any other interceptor: a service pause or dropped connection is waited
// out and safe requests are replayed, so open pages simply carry on.
// /auth/me answers 401 without a login: any non-5xx reply means the API is up.
installServiceContinuity(httpClient, { probePath: `${getApiBase()}/auth/me` });

// Renew valid device sessions before expiry; never retry document writes.
let renewal = null;
function tokenExpiry(token) {
  try { return JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).exp * 1000; }
  catch { return 0; }
}
async function renewSession(token) {
  if (!token || tokenExpiry(token) - Date.now() > 60 * 60 * 1000 || tokenExpiry(token) <= Date.now()) return;
  if (!renewal) {
    renewal = axios.post(`${getApiBase()}/auth/refresh`, {}, {
      headers: { Authorization: `Bearer ${token}` }, timeout: 10000,
    }).then(({ data }) => {
      if (localStorage.getItem("token") === token) localStorage.setItem("token", data.token);
    }).catch(() => { /* Original token remains valid until its actual expiry. */ })
      .finally(() => { renewal = null; });
  }
  await renewal;
}
// Attach the latest token after renewal, so parallel requests share one renewal.
httpClient.interceptors.request.use(
  async (config) => {
    const originalToken = localStorage.getItem("token");
    const companyId = localStorage.getItem("selectedCompanyId");
    const isLogin = /\/auth\/login$/.test(config.url || "");
    if (!/\/auth\/(login|logout|password|refresh)$/.test(config.url || ""))
      await renewSession(originalToken);
    const token = localStorage.getItem("token");
    if (!isLogin && !sameSession(originalToken, token))
      throw new axios.CanceledError("Session changed while the request was waiting.");
    if (companyId) config.headers["X-Company-Id"] = companyId;
    if (token && !isLogin) config.headers.Authorization = `Bearer ${token}`;
    if (isLogin) delete config.headers.Authorization;
    return config;
  },
  (error) => Promise.reject(error)
);

// Normalize the assorted error-body shapes the API can return so every
// caller can do `err.response.data.message` and get something useful:
//
//   1. Controller `BadRequest(new { message = "..." })`         → already has .message
//   2. Controller `BadRequest(new { error = "..." })`           → mirror to .message
//   3. ASP.NET ProblemDetails (DataAnnotations validation):
//        { errors: { Password: ["Must be ≥ 6 chars"], ... }, title, status }
//      → flatten to "Password: Must be ≥ 6 chars" and copy to .message
//   4. ModelState dictionary returned directly (older controllers)
//        { Password: ["..."], FullName: ["..."] }
//      → same flatten
//
// Without this, ProblemDetails responses left .message undefined and the
// UI fell back to "An error occurred", hiding the real validation reason.
function flattenErrors(errors) {
  if (!errors || typeof errors !== "object") return null;
  const parts = [];
  for (const [field, msgs] of Object.entries(errors)) {
    const list = Array.isArray(msgs) ? msgs : [String(msgs)];
    for (const m of list) {
      if (!m) continue;
      // If the field is a generic key (model-level), don't prefix it.
      const isGeneric = field === "" || field === "$" || /^\$?\.?$/.test(field);
      parts.push(isGeneric ? m : `${field}: ${m}`);
    }
  }
  return parts.length ? parts.join("; ") : null;
}

function ensureMessage(data) {
  if (!data || typeof data !== "object") return;
  if (typeof data.message === "string" && data.message) return; // already good
  if (typeof data.error === "string" && data.error) {
    data.message = data.error;
    return;
  }
  // ProblemDetails: { errors: {...}, title, status }
  const fromErrors = flattenErrors(data.errors);
  if (fromErrors) { data.message = fromErrors; return; }
  // Older raw ModelState dictionary (no envelope, just field→messages)
  if (!data.errors && !data.title) {
    const looksLikeModelState = Object.values(data).every(
      (v) => Array.isArray(v) || typeof v === "string");
    if (looksLikeModelState) {
      const flat = flattenErrors(data);
      if (flat) { data.message = flat; return; }
    }
  }
  if (typeof data.title === "string" && data.title) {
    data.message = data.title;
  }
}

// Response interceptor: normalize error bodies + handle a few global cases
httpClient.interceptors.response.use(
  (response) => {
    const bearer = response.config?.headers?.Authorization;
    if (bearer?.startsWith("Bearer ") && !sameSession(bearer.slice(7), localStorage.getItem("token")))
      return Promise.reject(new axios.CanceledError("Response belongs to a previous session."));
    return response;
  },
  (error) => {
    if (axios.isCancel(error)) return Promise.reject(error);
    const bearer = error.config?.headers?.Authorization;
    if (bearer?.startsWith("Bearer ") && !sameSession(bearer.slice(7), localStorage.getItem("token")))
      return Promise.reject(new axios.CanceledError("Error belongs to a previous session."));
    const status = error.response?.status;
    if (error.response?.data) ensureMessage(error.response.data);

    // `_skipAuthRedirect` opt-out — set by callers that want to handle
    // 401 themselves without triggering the global session-expired flow
    // (the AuthContext mount-time /auth/me probe is the canonical case;
    // see authApi.getCurrentUser({silent:true})). Without this guard, a
    // stale token in localStorage caused the probe to 401, the
    // interceptor saved postLoginReturnTo=<current path> (often "/"),
    // and after a successful re-login the operator was dropped on the
    // public landing page instead of /dashboard.
    const skipAuthRedirect = error.config?._skipAuthRedirect === true;
    // Don't capture the public landing page or the login page as a
    // valid return target — both would land the operator OFF the
    // protected app after re-login. Defense-in-depth alongside the
    // skipAuthRedirect flag above.
    const isReturnSafe = (p) =>
      typeof p === "string" && p.startsWith("/") && p !== "/" && !p.startsWith("/login");

    // The app is served under Vite's BASE_URL ("/admin/" in this build).
    // Stored return-paths stay ROUTER-relative ("/bills", not "/admin/bills")
    // so navigate(returnTo) works under the router basename; only the hard
    // window.location redirect below needs the real /admin-prefixed URL.
    const appBase = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");
    const routerHere = (() => {
      let p = window.location.pathname + window.location.search + window.location.hash;
      if (appBase && p.startsWith(appBase)) p = p.slice(appBase.length) || "/";
      return p;
    })();

    if (status === 401 && !routerHere.startsWith("/login") && !skipAuthRedirect
        && error.config?.headers?.Authorization === `Bearer ${localStorage.getItem("token")}`) {
      // Preserve where the operator was so re-login lands them back
      // there instead of dropping to /dashboard. Captured via sessionStorage
      // (survives the hard reload) — query-string would work too but a
      // long bill-edit URL with #anchors is fragile in URL form.
      try {
        if (isReturnSafe(routerHere)) {
          sessionStorage.setItem("postLoginReturnTo", routerHere);
        }
        // Distinct from the user typing a bad password — LoginPage uses
        // this to render a "session expired" banner.
        sessionStorage.setItem("loginReason", "expired");
      } catch { /* sessionStorage may be disabled (private mode) — non-fatal */ }
      localStorage.removeItem("token");
      window.location.href = appBase + "/login";
    } else if (status === 403) {
      // Surface the API's reason if it gave one (e.g. "Access denied:
      // you are not authorized for company N.") instead of the generic
      // "You don't have permission" toast.
      const m = error.response?.data?.message;
      notify(m || "You don't have permission to perform this action.", "warning");
      // Tenant guard refusal ("Access denied: you are not authorized for
      // company N" / "You do not have access to company N") — the
      // selected company may have been revoked while this tab was open.
      // CompanyContext listens and re-fetches the allowed list.
      if (typeof m === "string" && /company\s+\d+/i.test(m) && /access|authori[sz]ed/i.test(m)) {
        try { window.dispatchEvent(new Event("company-access-denied")); } catch { /* non-fatal */ }
      }
    } else if (status >= 500) {
      notify("Something went wrong on the server. Please try again.", "error");
    } else if (!error.response) {
      notify("Network error. Please check your connection.", "error");
    }

    return Promise.reject(error);
  }
);

export default httpClient;
