import httpClient from "./httpClient";

// Receipts (money in) and Payments (money out) share one backend service but
// are split by route + permission. `dir` is "receipts" | "payments" so the
// pages/forms can stay mode-driven without duplicating call sites.

export const getPagedPayments = (dir, companyId, params = {}) =>
  httpClient.get(`/payments/${dir}/company/${companyId}/paged`, { params });

export const getPaymentById = (dir, id) =>
  httpClient.get(`/payments/${dir}/${id}`);

export const createPayment = (dir, companyId, payload) =>
  httpClient.post(`/payments/${dir}/company/${companyId}`, payload);

export const deletePayment = (dir, id) =>
  httpClient.delete(`/payments/${dir}/${id}`);

// Settled-payments panel for a single document.
export const getPaymentsForInvoice = (companyId, invoiceId) =>
  httpClient.get(`/payments/company/${companyId}/by-invoice/${invoiceId}`);

export const getPaymentsForBill = (companyId, billId) =>
  httpClient.get(`/payments/company/${companyId}/by-bill/${billId}`);

// Set/clear an invoice or purchase-bill payment due date (drives Overdue status).
export const setInvoiceDueDate = (invoiceId, dueDate) =>
  httpClient.put(`/invoices/${invoiceId}/due-date`, { dueDate });

export const setBillDueDate = (billId, dueDate) =>
  httpClient.put(`/purchasebills/${billId}/due-date`, { dueDate });
