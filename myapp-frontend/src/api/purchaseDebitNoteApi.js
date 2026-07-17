import httpClient from "./httpClient";

// Purchase (supplier-side) debit notes. Full CRUD — user-created notes post GL
// and move stock; the Manager.io import is the other writer. Gated by
// purchasedebitnotes.* permissions.
export const getPurchaseDebitNotesByCompany = (companyId) =>
  httpClient.get(`/purchasedebitnotes/company/${companyId}`);

export const createPurchaseDebitNote = (payload) =>
  httpClient.post("/purchasedebitnotes", payload);

export const updatePurchaseDebitNote = (id, payload) =>
  httpClient.put(`/purchasedebitnotes/${id}`, payload);

export const getPurchaseDebitNoteById = (id) =>
  httpClient.get(`/purchasedebitnotes/${id}`);

// Merge data for printing a note (reuses the "DebitNote" print template).
export const getPurchaseDebitNotePrintData = (id) =>
  httpClient.get(`/purchasedebitnotes/${id}/print`);

export const deletePurchaseDebitNote = (id) =>
  httpClient.delete(`/purchasedebitnotes/${id}`);

export const getPurchaseDebitNotesCount = (companyId) =>
  httpClient.get("/purchasedebitnotes/count", { params: companyId ? { companyId } : {} });
