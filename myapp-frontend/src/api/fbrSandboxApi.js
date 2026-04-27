import http from "./httpClient";

// FBR Sandbox tab API client. Demo bills live in 900000+ numbering and never
// pollute the regular Bills page. Every endpoint is RBAC-gated server-side
// (fbr.sandbox.{view,seed,run,delete}) — the frontend hides actions for
// users without the matching permissions, but the server is the gate.

export const listSandbox = (companyId) =>
  http.get(`/fbr/sandbox/${companyId}`);

export const seedSandbox = (companyId) =>
  http.post(`/fbr/sandbox/${companyId}/seed`);

export const validateAllSandbox = (companyId) =>
  http.post(`/fbr/sandbox/${companyId}/validate-all`);

export const submitAllSandbox = (companyId) =>
  http.post(`/fbr/sandbox/${companyId}/submit-all`);

export const deleteSandboxBill = (companyId, billId) =>
  http.delete(`/fbr/sandbox/${companyId}/bill/${billId}`);

export const deleteAllSandbox = (companyId) =>
  http.delete(`/fbr/sandbox/${companyId}`);
