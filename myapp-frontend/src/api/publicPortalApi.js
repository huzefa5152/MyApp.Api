import axios from "axios";

// The PUBLIC portal's own client.
//
// Deliberately NOT the shared httpClient: that one attaches the operator's JWT
// from localStorage and, on a 401, wipes the token and redirects to /login. A
// customer opening their invoice link has no login to lose, and an internal
// user who happens to be signed in on the same browser must not have their
// session dragged into an anonymous request. This client sends no credentials
// and redirects nowhere.

function apiBase() {
  if (typeof window !== "undefined" && window._env_ && window._env_.API_URL) return window._env_.API_URL;
  if (import.meta && import.meta.env && import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  return "/api";
}

const anon = axios.create({
  baseURL: apiBase(),
  headers: { "Content-Type": "application/json" },
  withCredentials: false,
});

const root = (token) => `/public/customer-portal/${encodeURIComponent(token)}`;

export const getPortalHeader = (token) => anon.get(root(token));

export const getPortalInvoices = (token, params = {}) =>
  anon.get(`${root(token)}/invoices`, { params });

// Addressed by the NUMBER printed on the customer's own copy — there is no
// database id anywhere in this surface to substitute.
export const getPortalInvoice = (token, invoiceNumber) =>
  anon.get(`${root(token)}/invoices/${invoiceNumber}`);

export const getPortalPrintPayload = (token, invoiceNumber) =>
  anon.get(`${root(token)}/invoices/${invoiceNumber}/print`);
