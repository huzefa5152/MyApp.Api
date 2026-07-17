import httpClient from "./httpClient";

// Purchase (supplier-side) debit notes. Rows are created by the Manager.io
// import; this API is read + delete. Gated by purchasedebitnotes.* permissions.
export const getPurchaseDebitNotesByCompany = (companyId) =>
  httpClient.get(`/purchasedebitnotes/company/${companyId}`);

export const getPurchaseDebitNoteById = (id) =>
  httpClient.get(`/purchasedebitnotes/${id}`);

export const deletePurchaseDebitNote = (id) =>
  httpClient.delete(`/purchasedebitnotes/${id}`);

export const getPurchaseDebitNotesCount = (companyId) =>
  httpClient.get("/purchasedebitnotes/count", { params: companyId ? { companyId } : {} });
