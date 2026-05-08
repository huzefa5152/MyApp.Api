// src/api/fbrPurchaseImportApi.js
//
// Thin client for the FBR Annexure-A purchase ledger importer. Phase 1
// exposes preview only (read-only, no DB writes).
import httpClient from "./httpClient";

/**
 * Upload the FBR Annexure-A xls/xlsx and ask the backend for a per-row
 * import preview. Returns the FbrImportPreviewResponse shape:
 *
 *   {
 *     summary:    { fileName, companyId, totalRows, totalInvoices,
 *                   decisionCounts: { willImport, alreadyExists, ... } },
 *     invoices:   [ { fbrInvoiceRefNo, supplierNtn, supplierName,
 *                     invoiceNo, invoiceDate, totalGrossValue,
 *                     matchedSupplierId, matchedPurchaseBillId,
 *                     decision, lines: [...] } ],
 *     warnings:   [ "string" ]
 *   }
 *
 * Throws on network / 4xx / 5xx — caller wraps in try/catch.
 */
export async function previewFbrPurchaseImport(file, companyId) {
  const form = new FormData();
  form.append("file", file);
  form.append("companyId", String(companyId));
  const { data } = await httpClient.post("/fbr-purchase-import/preview", form, {
    // axios sets the multipart boundary; we just need to defeat the
    // default JSON content-type from httpClient.
    headers: { "Content-Type": "multipart/form-data" },
    // FBR exports for active months can be 5+ MB — uploads can take a
    // few seconds. 60s is generous; backend has a 25 MB request cap.
    timeout: 60000,
  });
  return data;
}

/**
 * Commit the import — re-uploads the same file (server re-parses to
 * stay stateless) and writes Suppliers / PurchaseBills / ItemTypes /
 * StockMovements for every row tagged will-import /
 * product-will-be-created. Per-invoice transactions; idempotent on
 * retry because the dedup matcher catches already-imported rows.
 *
 * Returns the FbrImportCommitResponse shape:
 *   {
 *     fileName, companyId, committedAt, committedByUserId,
 *     counts: {
 *       invoicesImported, invoicesSkipped, invoicesFailed,
 *       suppliersCreated, itemTypesCreated, linesImported,
 *       stockMovementsRecorded, previewDecisionCounts: {...}
 *     },
 *     invoices: [{ invoiceNo, supplierName, outcome,
 *                  createdPurchaseBillId, errorMessage }],
 *     warnings: [...]
 *   }
 */
export async function commitFbrPurchaseImport(file, companyId) {
  const form = new FormData();
  form.append("file", file);
  form.append("companyId", String(companyId));
  const { data } = await httpClient.post("/fbr-purchase-import/commit", form, {
    headers: { "Content-Type": "multipart/form-data" },
    // Commits do more work than previews (DB writes, transactions per
    // invoice). 5 minutes covers a 500-row file even on a slow link.
    timeout: 300000,
  });
  return data;
}
