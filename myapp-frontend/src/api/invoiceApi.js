import httpClient from "./httpClient";

export const getInvoicesByCompany = (companyId) =>
  httpClient.get(`/invoices/company/${companyId}`);

export const getPagedInvoicesByCompany = (companyId, params = {}) =>
  httpClient.get(`/invoices/company/${companyId}/paged`, { params });

export const getInvoiceById = (id) =>
  httpClient.get(`/invoices/${id}`);

export const createInvoice = (payload) =>
  httpClient.post("/invoices", payload);

export const updateInvoice = (id, payload) =>
  httpClient.put(`/invoices/${id}`, payload);

export const deleteInvoice = (id) =>
  httpClient.delete(`/invoices/${id}`);

// Toggle the "exclude from FBR bulk actions" flag on a bill.
// When excluded=true, Validate All / Submit All skip this bill.
// Per-bill Validate / Submit buttons still work regardless.
export const setInvoiceFbrExcluded = (id, excluded) =>
  httpClient.put(`/invoices/${id}/fbr-excluded`, { excluded });

export const getInvoicePrintBill = (invoiceId) =>
  httpClient.get(`/invoices/${invoiceId}/print/bill`);

export const getInvoicePrintTaxInvoice = (invoiceId) =>
  httpClient.get(`/invoices/${invoiceId}/print/tax-invoice`);

export const getInvoicesCount = (companyId) =>
  httpClient.get("/invoices/count", { params: companyId ? { companyId } : {} });
