import httpClient from "./httpClient";

export const getInvoicesByCompany = (companyId) =>
  httpClient.get(`/invoices/company/${companyId}`);

export const getPagedInvoicesByCompany = (companyId, params = {}) =>
  httpClient.get(`/invoices/company/${companyId}/paged`, { params });

export const getInvoiceById = (id) =>
  httpClient.get(`/invoices/${id}`);

export const createInvoice = (payload) =>
  httpClient.post("/invoices", payload);

// Create a bill WITHOUT a linked delivery challan — for FBR-only flows
// (service invoices, retail walk-ins, ad-hoc billing) where no challan
// was issued. Bill numbering shares the regular sequence so the bill
// shows up on the same Bills page as challan-linked bills.
// Gated server-side by `invoices.manage.create.standalone`.
export const createStandaloneInvoice = (payload) =>
  httpClient.post("/invoices/standalone", payload);

export const updateInvoice = (id, payload) =>
  httpClient.put(`/invoices/${id}`, payload);

// Narrow-permission edit path — only re-classifies each line by ItemType.
// Server re-derives HS Code / UOM / Sale Type from the catalog and refuses
// to touch any other field on the bill. Used when the operator has
// invoices.manage.update.itemtype but NOT the broader invoices.manage.update.
export const updateInvoiceItemTypes = (id, items) =>
  httpClient.patch(`/invoices/${id}/itemtypes`, { items });

// Slightly broader narrow edit path — Item Type AND Quantity per line.
// Server still refuses to change price / desc / GST / dates / payment terms
// / SRO etc. Decimal validation applies (fractional qty rejected for
// integer-only UOMs). Gated by invoices.manage.update.itemtype.qty.
//
// writeMode (2026-05-11) — "bill" (default) writes straight to InvoiceItem,
// "adjustment" persists changes as an InvoiceItemAdjustment overlay,
// leaving the underlying bill row untouched. Use "adjustment" from
// Invoice-mode saves so the printed bill stays at real qty/price while
// the FBR-side claim math reads the optimized decomposition.
export const updateInvoiceItemTypesAndQty = (id, items, writeMode = "bill") =>
  httpClient.patch(`/invoices/${id}/itemtypes-and-qty`, { items, writeMode });

export const deleteInvoice = (id) =>
  httpClient.delete(`/invoices/${id}`);

// Void (cancel) a non-FBR-submitted bill. Unlike delete (trailing bill only,
// removes the row), cancel works on ANY non-submitted bill: it keeps the bill
// number so the sequence stays gap-free, flags the bill cancelled, and reverts
// its linked delivery challans back to Pending so they can be re-billed.
// Gated server-side by `bills.manage.delete`.
export const cancelInvoice = (id, reason) =>
  httpClient.post(`/invoices/${id}/cancel`, { reason: reason ?? null });

// Reverse an FBR-SUBMITTED bill. The server auto-generates the correct
// adjustment note — a Credit Note (return/reversal, the default) or a Debit
// Note (upward correction, docType=9) — as a new UNSUBMITTED bill that then
// flows through the normal Validate → Submit-to-FBR path. Returns the new note.
// Gated server-side by `invoices.note.create`.
export const reverseInvoice = (id, { reason, remarks, documentType } = {}) =>
  httpClient.post(`/invoices/${id}/reverse`, {
    reason: reason ?? null,
    remarks: remarks ?? null,
    documentType: documentType ?? null,
  });

// Manually create a Credit/Debit Note referencing an FBR-submitted invoice,
// with optional PARTIAL line selection. Powers the Credit/Debit Note screen.
// payload: { originalInvoiceId, documentType (9|10), reason, remarks, date?,
//            lines: [{ invoiceItemId, quantity }] }  (empty lines = full reversal)
// Gated server-side by `invoices.note.create`.
export const createNote = (payload) =>
  httpClient.post("/invoices/notes", payload);

// Bill quantity under-reported on an FBR-submitted invoice as a NEW unclassified
// delta bill (+ cloned challan/PO), then hand to the tax consultant to classify
// (HS Code) and submit. payload: { lines: [{ invoiceItemId, quantity, unitPrice? }],
// carryChallan?, reason?, date? }. Gated server-side by `invoices.note.create`.
export const supplementInvoice = (id, payload) =>
  httpClient.post(`/invoices/${id}/supplement`, payload);

// Toggle the "exclude from FBR bulk actions" flag on a bill.
// When excluded=true, Validate All / Submit All skip this bill.
// Per-bill Validate / Submit buttons still work regardless.
export const setInvoiceFbrExcluded = (id, excluded) =>
  httpClient.put(`/invoices/${id}/fbr-excluded`, { excluded });

// ── Customer document handover (2026-08) ───────────────────────────
// Mark an FBR-submitted invoice's customer documents as handed over to the
// customer (optional remark). Gated server-side by invoices.docs.deliver.
export const markInvoiceHandover = (id, remark) =>
  httpClient.post(`/invoices/${id}/handover`, { remark: remark ?? null });

// Revert a delivered invoice's customer documents back to Pending.
// Gated server-side by invoices.docs.revert.
export const revertInvoiceHandover = (id) =>
  httpClient.post(`/invoices/${id}/handover/revert`);

// Bulk-mark customer documents delivered across many invoices at once.
// The server skips ineligible / cross-tenant ids and returns a per-id
// summary { delivered, skipped, rows[] }. Gated by invoices.docs.deliver.
export const bulkInvoiceHandover = (ids, remark) =>
  httpClient.post(`/invoices/handover/bulk`, { ids, remark: remark ?? null });

export const getInvoicePrintBill = (invoiceId) =>
  httpClient.get(`/invoices/${invoiceId}/print/bill`);

export const getInvoicePrintTaxInvoice = (invoiceId) =>
  httpClient.get(`/invoices/${invoiceId}/print/tax-invoice`);

// Tax Invoice print data for many invoices in one round-trip, returned in the
// order the ids were sent. Backs the Sales report's PDF downloads; gated by
// reports.sales.printinvoice, and the server caps the list at 100 per call.
export const getInvoicePrintTaxInvoiceBatch = (invoiceIds) =>
  httpClient.post(`/invoices/print/tax-invoice/batch`, { invoiceIds });

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

// Sale bills awaiting procurement — picker for the "Purchase Against
// Sale Bill" flow. Returns bills that have HSCode-empty lines with
// remaining qty AND every line has an ItemType set.
export const getAwaitingPurchase = (companyId) =>
  httpClient.get(`/invoices/company/${companyId}/awaiting-purchase`);

// Per-line procurement template for one sale bill. Lines grouped by
// ItemType so 28 "Medicines" entries collapse to one procurement row.
export const getPurchaseTemplate = (invoiceId) =>
  httpClient.get(`/invoices/${invoiceId}/purchase-template`);
