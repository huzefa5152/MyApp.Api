import httpClient from "./httpClient";

// Internal management of public customer portals. Authenticated + RBAC-gated —
// the PUBLIC side deliberately uses its own bare fetch layer (api/portalApi.js),
// never this client.
//
// Note that every response here carries live `publicUrl` values, and a portal
// URL is a bearer capability over a client's invoices. Don't log these payloads.

export const getCustomerPortals = () =>
  httpClient.get("/customer-portals");

export const getCustomerPortal = (id) =>
  httpClient.get(`/customer-portals/${id}`);

/** The server mints the token and builds the URL — never construct either here. */
export const createCustomerPortal = (companyId, clientId) =>
  httpClient.post("/customer-portals", { companyId, clientId });

export const setCustomerPortalActive = (id, isActive) =>
  httpClient.put(`/customer-portals/${id}/active`, { isActive });

export const deleteCustomerPortal = (id) =>
  httpClient.delete(`/customer-portals/${id}`);
