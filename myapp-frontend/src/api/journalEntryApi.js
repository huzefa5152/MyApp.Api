import httpClient from "./httpClient";

// Journal entries. The listing returns EVERY entry — system-posted and manual —
// so the screen doubles as the ledger browser; only manual entries can be
// created, edited or deleted, and the server refuses the rest.

export const getPagedJournalEntries = (companyId, params = {}) =>
  httpClient.get(`/journal-entries/company/${companyId}/paged`, { params });

export const getJournalEntry = (id) =>
  httpClient.get(`/journal-entries/${id}`);

export const createJournalEntry = (companyId, payload) =>
  httpClient.post(`/journal-entries/company/${companyId}`, payload);

export const updateJournalEntry = (id, payload) =>
  httpClient.put(`/journal-entries/${id}`, payload);

export const deleteJournalEntry = (id) =>
  httpClient.delete(`/journal-entries/${id}`);
