import http from "./httpClient";

// Withholding Tax Receipts — customer-issued tax certificates (tax the
// customer withheld at source and remitted on our behalf). The per-customer
// sum drives the "Withholding tax receivable" column on the Customers screen.

export const getWithholdingReceiptsByCompany = (companyId) =>
  http.get(`/withholdingtaxreceipts/company/${companyId}`);

export const getWithholdingReceiptById = (id) =>
  http.get(`/withholdingtaxreceipts/${id}`);

// Payload: { clientId, divisionId?, date, amount, description? }
export const createWithholdingReceipt = (companyId, payload) =>
  http.post(`/withholdingtaxreceipts/company/${companyId}`, payload);

export const updateWithholdingReceipt = (id, payload) =>
  http.put(`/withholdingtaxreceipts/${id}`, payload);

export const deleteWithholdingReceipt = (id) =>
  http.delete(`/withholdingtaxreceipts/${id}`);

export const getWithholdingReceiptsCount = (companyId) =>
  http.get("/withholdingtaxreceipts/count", { params: companyId ? { companyId } : {} });
