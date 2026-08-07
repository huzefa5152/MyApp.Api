import httpClient from "./httpClient";

// Chart of Accounts (design §7).
export const getCoaTree = (companyId) =>
  httpClient.get(`/accounts/company/${companyId}/tree`);

export const getAccountsFlat = (companyId) =>
  httpClient.get(`/accounts/company/${companyId}/flat`);

// Bank/cash accounts for the receipt/payment "Received in / Paid from" picker
// (active-only by default). The management screen passes includeInactive to see
// retired accounts (badged) and get the per-row hasActivity hint.
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

// Correct a bank/cash account's opening balance; the offsetting delta lands in
// Retained earnings server-side so the balance sheet stays balanced.
export const adjustOpeningBalance = (id, payload) =>
  httpClient.post(`/accounts/${id}/adjust-opening-balance`, payload);

export const seedWholesaleCoa = (companyId) =>
  httpClient.post(`/accounts/company/${companyId}/seed-wholesale`);
