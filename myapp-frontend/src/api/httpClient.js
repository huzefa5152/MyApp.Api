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
  (response) => response,
  (error) => {
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
    // "/portal/..." is excluded because that path CONTAINS A SECRET: it is the
    // public customer portal's access token. Storing it in sessionStorage would
    // leave a live capability where any script on the origin can read it. The
    // portal has its own fetch layer and never reaches this interceptor, so this
    // is belt-and-braces for an operator who happens to be on a portal URL.
    const isReturnSafe = (p) =>
      typeof p === "string" && p.startsWith("/") && p !== "/"
      && !p.startsWith("/login") && !p.startsWith("/portal/");

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

    if (status === 401 && !routerHere.startsWith("/login") && !skipAuthRedirect) {
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
      // A 403 on a background READ (GET/HEAD — lookup/picker feeds, list
      // fetches) is usually not actionable: the dropdown / page renders its own
      // inline "failed to load" state, so a global warning toast was pure noise.
      // The canonical case: opening an invoice/challan/quote create form whose
      // client/division picker feed the role isn't scoped for — the operator got
      // a scary "you don't have permission" toast for a form they CAN use.
      //
      // So warn only on 403s the user directly caused — the mutating verbs
      // (POST/PUT/PATCH/DELETE) behind a clicked action. A caller can force the
      // toast on a read via `_forcePermissionToast`, or suppress it on any
      // request via `_skipPermissionToast`. The API's own reason message
      // (e.g. "Access denied: you are not authorized for company N.") is
      // preferred over the generic text when a toast does fire.
      const method = (error.config?.method || "get").toLowerCase();
      const isRead = method === "get" || method === "head";
      const skip = error.config?._skipPermissionToast === true;
      const force = error.config?._forcePermissionToast === true;
      if (!skip && (force || !isRead)) {
        const m = error.response?.data?.message;
        notify(m || "You don't have permission to perform this action.", "warning");
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
