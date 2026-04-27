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

// Narrow-permission edit path — only re-classifies each line by ItemType.
// Server re-derives HS Code / UOM / Sale Type from the catalog and refuses
// to touch any other field on the bill. Used when the operator has
// invoices.manage.update.itemtype but NOT the broader invoices.manage.update.
export const updateInvoiceItemTypes = (id, items) =>
  httpClient.patch(`/invoices/${id}/itemtypes`, { items });

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

// Flat search across a company's bill lines for the Item Rate History page.
// params: { itemTypeId?, search?, clientId?, dateFrom?, dateTo?, page?, pageSize? }
export const getItemRateHistory = (companyId, params = {}) =>
  httpClient.get(`/invoices/company/${companyId}/item-rate-history`, { params });

// Per-item last-billed rate for every line on a challan. Used by the
// "Generate Bill" shortcut to pre-fill unit prices in the InvoiceForm.
// Returns an array of { deliveryItemId, lastUnitPrice, lastInvoiceNumber,
// lastInvoiceDate, lastClientName, matchedBy } — items without history
// have nulls so the UI can leave them blank.
export const getLastRatesForChallan = (companyId, challanId) =>
  httpClient.get(`/invoices/company/${companyId}/last-rates`, { params: { challanId } });
