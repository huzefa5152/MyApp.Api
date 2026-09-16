import httpClient from "./httpClient";

// Customer Portal MANAGEMENT. Every response here carries a live bearer token
// inside publicUrl, so these calls are permission-gated server-side and the
// results must not be logged or echoed anywhere else.

export const getCustomerPortals = () =>
  httpClient.get("/customer-portals");

export const getPortalDocumentOptions = (companyId) =>
  httpClient.get(`/customer-portals/company/${companyId}/document-options`);

export const createCustomerPortal = (payload) =>
  httpClient.post("/customer-portals", payload);

export const setPortalDocumentType = (id, documentType) =>
  httpClient.put(`/customer-portals/${id}/document-type`, { documentType });

// Disabling stops access at once; re-enabling restores the SAME link, so a
// customer who already has it does not need a new one.
export const setPortalActive = (id, isActive) =>
  httpClient.put(`/customer-portals/${id}/active`, { isActive });

// Revoking is permanent — the row goes and the token can never resolve again.
export const deleteCustomerPortal = (id) =>
  httpClient.delete(`/customer-portals/${id}`);
