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

export const getJournalEntryPrintData = (id) =>
  httpClient.get(`/journal-entries/${id}/print`);

export const createJournalEntry = (companyId, payload) =>
  httpClient.post(`/journal-entries/company/${companyId}`, payload);

export const updateJournalEntry = (id, payload) =>
  httpClient.put(`/journal-entries/${id}`, payload);

export const deleteJournalEntry = (id) => httpClient.delete(`/journal-entries/${id}`);

// ── Inter-account transfers ─────────────────────────────────────────────────
export const getTransfersPaged = (companyId, params = {}) =>
  httpClient.get(`/account-transfers/company/${companyId}/paged`, { params });

export const getTransfer = (id) => httpClient.get(`/account-transfers/${id}`);

export const getTransferPrintData = (id) =>
  httpClient.get(`/account-transfers/${id}/print`);

// ── Bank reconciliation (BANK_RECONCILIATION_DESIGN.md) ──────────────────────
// Per-account actual/cleared/pending summary + cleared-state toggles. Toggling
// cleared is pure metadata — it never posts to the GL.
export const getBankReconSummary = (companyId) =>
  httpClient.get(`/bank-reconciliation/company/${companyId}/summary`);

export const setPaymentCleared = (paymentId, cleared, clearedDate = null) =>
  httpClient.post(`/bank-reconciliation/payment/${paymentId}/cleared`, { cleared, clearedDate });

export const setTransferCleared = (transferId, cleared, clearedDate = null) =>
  httpClient.post(`/bank-reconciliation/transfer/${transferId}/cleared`, { cleared, clearedDate });

// Reconcile workflow (Phase 3): the account's transactions to tick, a lock call,
// and the locked-reconciliation history.
export const getReconcileTransactions = (accountId) =>
  httpClient.get(`/bank-reconciliation/account/${accountId}/transactions`);

export const getReconciliationHistory = (accountId) =>
  httpClient.get(`/bank-reconciliation/account/${accountId}/history`);

export const lockReconciliation = (companyId, payload) =>
  httpClient.post(`/bank-reconciliation/company/${companyId}/lock`, payload);

// Statement import (Phase 2): import CSV text, list staged lines, categorize
// (into a new receipt/payment against a contra account) or ignore.
export const importBankStatement = (companyId, payload) =>
  httpClient.post(`/bank-statements/company/${companyId}/import`, payload);

export const getStatementLines = (accountId, status) =>
  httpClient.get(`/bank-statements/account/${accountId}/lines`, { params: status ? { status } : {} });

export const categorizeStatementLine = (lineId, payload) =>
  httpClient.post(`/bank-statements/line/${lineId}/categorize`, payload);

export const ignoreStatementLine = (lineId) =>
  httpClient.post(`/bank-statements/line/${lineId}/ignore`);

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
