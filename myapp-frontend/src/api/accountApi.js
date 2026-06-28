import httpClient from "./httpClient";

// Chart of Accounts (design §7).
export const getCoaTree = (companyId) =>
  httpClient.get(`/accounts/company/${companyId}/tree`);

export const getAccountsFlat = (companyId) =>
  httpClient.get(`/accounts/company/${companyId}/flat`);

// Bank/cash accounts for the receipt/payment "Received in / Paid from" picker.
export const getBankCashAccounts = (companyId) =>
  httpClient.get(`/accounts/company/${companyId}/bank-cash`);

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

export const seedWholesaleCoa = (companyId) =>
  httpClient.post(`/accounts/company/${companyId}/seed-wholesale`);
