import httpClient from "./httpClient";

// Receipts (money in) and Payments (money out) share one backend service but
// are split by route + permission. `dir` is "receipts" | "payments" so the
// pages/forms can stay mode-driven without duplicating call sites.

export const getPagedPayments = (dir, companyId, params = {}) =>
  httpClient.get(`/payments/${dir}/company/${companyId}/paged`, { params });

export const getPaymentById = (dir, id) =>
  httpClient.get(`/payments/${dir}/${id}`);

// Print-ready voucher DTO (branding + contact + allocations + amount-in-words).
export const getPaymentPrintData = (dir, id) =>
  httpClient.get(`/payments/${dir}/${id}/print`);

// `payload` is passed through as-is. For a receipt, PaymentForm now always
// includes `amount` (the typed cash total — authoritative; any uncovered
// remainder becomes the customer's advance). Sending it on UPDATE too matters
// just as much as on CREATE: omit it and the API's backward-compat fallback
// derives Amount from Σ allocation cash, silently flattening an existing
// advance on edit. Money-out (Payments) never sets `amount` — its total stays
// server-derived from the allocations, unchanged.
export const createPayment = (dir, companyId, payload) =>
  httpClient.post(`/payments/${dir}/company/${companyId}`, payload);

export const updatePayment = (dir, id, payload) =>
  httpClient.put(`/payments/${dir}/${id}`, payload);

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

// ── Auto-allocation (FIFO, oldest invoice first) ─────────────────────────────
// The split itself is computed server-side (Helpers/ReceiptAllocationPlanner)
// so there is exactly one implementation of the rule. The form asks what the
// server WOULD do, fills its boxes with the answer, and lets the operator edit
// it before saving through the normal create path.

export const getAllocationPlan = (companyId, clientId, amount) =>
  httpClient.get(`/receipts/company/${companyId}/allocation-plan`, {
    params: { clientId, amount },
  });

// Applies FIFO to a SAVED receipt's still-unallocated cash (the advance case).
export const autoAllocateReceipt = (id) =>
  httpClient.post(`/receipts/${id}/auto-allocate`);

// Sweeps every advance this customer holds onto their outstanding invoices.
// Returns a per-receipt report; a receipt that could not be applied is named
// with the reason rather than dropped.
export const applyClientAdvances = (companyId, clientId) =>
  httpClient.post(`/receipts/company/${companyId}/apply-advances`, null, {
    params: { clientId },
  });
