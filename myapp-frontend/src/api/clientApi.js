import http from "./httpClient";

export const getClients = () => http.get("/clients");
export const getClientsByCompany = (companyId) => http.get(`/clients/company/${companyId}`);
export const getClientById = (id) => http.get(`/clients/${id}`);
export const createClient = (payload) => http.post("/clients", payload);

// Multi-company create — one form, N Client rows (one per company).
// Selecting 2+ companies auto-collapses them into a Common Client.
// Payload shape: { ...clientFields, companyIds: [1, 2] }
// Response shape: { created: [Client...], skippedReasons: ["..."], clientGroupId }
export const createClientBatch = (payload) => http.post("/clients/batch", payload);
// Copy an existing client into one or more target companies. The server
// reuses the source's identifying fields so the new rows auto-link to
// the source's Common Client group (NTN / normalised-name match).
// Payload: { companyIds: [2, 3, ...] }
// Response shape mirrors createClientBatch.
export const copyClientToCompanies = (id, companyIds) =>
  http.post(`/clients/${id}/copy`, { companyIds });
export const updateClient = (id, payload) => http.put(`/clients/${id}`, payload);
export const deleteClient = (id) => http.delete(`/clients/${id}`);
export const getClientsCount = (companyId) =>
  http.get("/clients/count", { params: companyId ? { companyId } : {} });

// Common Clients (group view) — multi-company duplicates collapsed into
// a single editable record. Single-company clients DO NOT appear here;
// they keep working through the per-company endpoints above.
export const getCommonClients = (companyId) =>
  http.get("/clients/common", { params: { companyId } });

// Every Client Group — single-company AND multi-company. Used by
// config screens (PO Formats etc.) that pick "one row per legal
// entity" rather than per tenant. Each item carries CompanyCount
// so the picker can hint which entries are cross-tenant.
export const getAllClientGroups = () => http.get("/clients/groups");
export const getCommonClientById = (groupId) =>
  http.get(`/clients/common/${groupId}`);
export const updateCommonClient = (groupId, payload) =>
  http.put(`/clients/common/${groupId}`, payload);

// Delete a Common Client across every tenant — removes the per-
// company Client row in each company plus their cascading data
// (invoices, items, delivery challans). Same destructive shape as
// the per-tenant DELETE, just N tenants in one operator action.
export const deleteCommonClient = (groupId) =>
  http.delete(`/clients/common/${groupId}`);
