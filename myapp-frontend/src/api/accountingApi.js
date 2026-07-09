import httpClient from "./httpClient";

// ── General Ledger admin (Phase B) ──────────────────────────────────────────
export const getGlStatus = (companyId) =>
  httpClient.get(`/accounting/gl/company/${companyId}/status`);

export const enableGl = (companyId) =>
  httpClient.post(`/accounting/gl/company/${companyId}/enable`);

export const rebuildGl = (companyId) =>
  httpClient.post(`/accounting/gl/company/${companyId}/rebuild`);

export const setGlLockDate = (companyId, lockDate) =>
  httpClient.put(`/accounting/gl/company/${companyId}/lock-date`, { lockDate });

// ── Account ledger drill-down ───────────────────────────────────────────────
export const getAccountLedger = (accountId, params = {}) =>
  httpClient.get(`/accounts/${accountId}/ledger`, { params });

// ── Journal entries ─────────────────────────────────────────────────────────
export const getJournalEntriesPaged = (companyId, params = {}) =>
  httpClient.get(`/journal-entries/company/${companyId}/paged`, { params });

export const getJournalEntry = (id) => httpClient.get(`/journal-entries/${id}`);

export const createJournalEntry = (companyId, payload) =>
  httpClient.post(`/journal-entries/company/${companyId}`, payload);

export const updateJournalEntry = (id, payload) =>
  httpClient.put(`/journal-entries/${id}`, payload);

export const deleteJournalEntry = (id) => httpClient.delete(`/journal-entries/${id}`);

// ── Inter-account transfers ─────────────────────────────────────────────────
export const getTransfersPaged = (companyId, params = {}) =>
  httpClient.get(`/account-transfers/company/${companyId}/paged`, { params });

export const getTransfer = (id) => httpClient.get(`/account-transfers/${id}`);

export const createTransfer = (companyId, payload) =>
  httpClient.post(`/account-transfers/company/${companyId}`, payload);

export const updateTransfer = (id, payload) =>
  httpClient.put(`/account-transfers/${id}`, payload);

export const deleteTransfer = (id) => httpClient.delete(`/account-transfers/${id}`);

// ── Reports ─────────────────────────────────────────────────────────────────
export const getTrialBalance = (companyId, params = {}) =>
  httpClient.get(`/accounting/reports/company/${companyId}/trial-balance`, { params });

export const getAgedReceivables = (companyId) =>
  httpClient.get(`/accounting/reports/company/${companyId}/aged-receivables`);

export const getAgedPayables = (companyId) =>
  httpClient.get(`/accounting/reports/company/${companyId}/aged-payables`);

// ── Accounting summary (dashboard) ──────────────────────────────────────────
export const getAccountingSummary = (companyId, params = {}) =>
  httpClient.get(`/accounting/summary/company/${companyId}`, { params });

// ── Cheque / PDC register ───────────────────────────────────────────────────
export const setChequeStatus = (paymentId, status) =>
  httpClient.patch(`/payments/${paymentId}/cheque-status`, { status });
