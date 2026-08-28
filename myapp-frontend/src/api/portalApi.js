// Public Customer Portal — its own fetch layer, deliberately NOT httpClient.
//
// httpClient attaches `Bearer localStorage.token` to every request, and on a 401
// it clears the token, writes the current path into sessionStorage and hard-
// navigates to the operator login page. On a public page that is actively
// harmful in two directions:
//
//   • it would send an operator's JWT to anonymous endpoints if they happen to
//     open a portal link in the same browser — a silent widening that would
//     never show up in anonymous testing; and
//   • it would persist the SECRET portal URL into sessionStorage, where any
//     script on the origin can read it.
//
// So: bare fetch, no Authorization header, no interceptors, no redirects. The
// token in the URL is the only credential this layer knows about.

const API_BASE = (window._env_ && window._env_.API_URL) || "/api";

async function portalGet(path, params) {
  const qs = params
    ? "?" + new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")
      ).toString()
    : "";

  const res = await fetch(`${API_BASE}${path}${qs}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "omit",
  });

  if (!res.ok) {
    // The server returns one generic body for every token failure so a stranger
    // can't tell a revoked portal from a wrong guess. Keep it that way here.
    let message = "This customer portal is no longer available.";
    try {
      const body = await res.json();
      if (body && body.message) message = body.message;
    } catch { /* non-JSON error body — keep the generic message */ }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** Reads the token out of /portal/<token> — the page renders outside the router. */
export function portalTokenFromLocation() {
  const m = window.location.pathname.match(/\/portal\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

export const getPortal = (token) =>
  portalGet(`/public/customer-portal/${token}`);

export const getPortalInvoices = (token, params) =>
  portalGet(`/public/customer-portal/${token}/invoices`, params);

export const getPortalInvoice = (token, invoiceNumber) =>
  portalGet(`/public/customer-portal/${token}/invoices/${invoiceNumber}`);

export const getPortalPrintPayload = (token, invoiceNumber) =>
  portalGet(`/public/customer-portal/${token}/invoices/${invoiceNumber}/print`);
