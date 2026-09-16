import httpClient from "./httpClient";

// General ledger: status, period close, the account drill-down and the trial
// balance. There is no "disable GL" call and there never will be — posting is
// on for every company and a company that has posted can't stop.

export const getGlStatus = (companyId) =>
  httpClient.get(`/accounting/gl/company/${companyId}/status`);

// lockDate null reopens the books. Everything dated on or before the lock date
// is frozen — additions, edits and deletions alike.
export const setGlLockDate = (companyId, lockDate) =>
  httpClient.put(`/accounting/gl/company/${companyId}/lock-date`, { lockDate });

export const getAccountLedger = (accountId, params = {}) =>
  httpClient.get(`/accounts/${accountId}/ledger`, { params });

export const getTrialBalance = (companyId, params = {}) =>
  httpClient.get(`/accounting/reports/company/${companyId}/trial-balance`, { params });
