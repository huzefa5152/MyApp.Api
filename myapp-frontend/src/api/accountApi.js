import httpClient from "./httpClient";

// Chart of Accounts. The tree drives the Chart of Accounts screen; the flat
// list and the bank/cash list feed the pickers on documents, receipts and
// payments (which is why those two are gated more widely than coa.view).

export const getCoaTree = (companyId) =>
  httpClient.get(`/accounts/company/${companyId}/tree`);

export const getAccountsFlat = (companyId) =>
  httpClient.get(`/accounts/company/${companyId}/flat`);

// includeInactive is for the management screen — the pickers want active only,
// and skipping it also skips the per-row "has activity?" lookup on the server.
export const getBankCashAccounts = (companyId, includeInactive = false) =>
  httpClient.get(`/accounts/company/${companyId}/bank-cash`, { params: { includeInactive } });

export const createAccountGroup = (companyId, payload) =>
  httpClient.post(`/accounts/company/${companyId}/groups`, payload);

export const updateAccountGroup = (id, payload) =>
  httpClient.put(`/accounts/groups/${id}`, payload);

export const deleteAccountGroup = (id) =>
  httpClient.delete(`/accounts/groups/${id}`);

export const createAccount = (companyId, payload) =>
  httpClient.post(`/accounts/company/${companyId}`, payload);

export const updateAccount = (id, payload) =>
  httpClient.put(`/accounts/${id}`, payload);

export const deleteAccount = (id) =>
  httpClient.delete(`/accounts/${id}`);

// Correct a bank/cash account's starting balance. The offsetting delta lands on
// Retained earnings server-side, so the opening balance sheet still balances.
export const adjustOpeningBalance = (id, payload) =>
  httpClient.post(`/accounts/${id}/adjust-opening-balance`, payload);

// Lay down the Wholesale / Distribution preset on an empty chart. Idempotent —
// a re-run adds only what is missing.
export const seedWholesaleCoa = (companyId) =>
  httpClient.post(`/accounts/company/${companyId}/seed-wholesale`);
