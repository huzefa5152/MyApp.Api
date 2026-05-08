// src/api/taxClaimApi.js
//
// Helper for the in-form Tax Claim panel on the Invoices-tab edit
// screen. Phase B — sends the full bill state (HS-aggregated rows +
// bill date + GST rate) and gets back a Pakistan-compliance summary:
// per-sale match, §8A aging, §8B 90% cap, IRIS reconciliation,
// pending-but-not-yet-claimable bills, carry-forward proxy.
import httpClient from "./httpClient";

/**
 * POST /api/tax-claim/claim-summary
 *
 * Returns the TaxClaimSummaryResponse shape — see DTOs/TaxClaimDtos.cs.
 *
 * Read-only; safe to retry. The endpoint is informational — even
 * when a row reports "no purchases on record" the operator is never
 * blocked from saving (they can record the matching purchase later).
 */
export async function getClaimSummary({
  companyId,
  billDate,
  billGstRate,
  billRows,
  periodCode = "this-month",
}) {
  const { data } = await httpClient.post("/tax-claim/claim-summary", {
    companyId,
    billDate: billDate instanceof Date ? billDate.toISOString() : billDate,
    billGstRate: Number(billGstRate) || 0,
    billRows: Array.isArray(billRows)
      ? billRows.map((r) => ({
          hsCode: r.hsCode,
          itemTypeName: r.itemTypeName || "",
          qty: Number(r.qty) || 0,
          value: Number(r.value) || 0,
        }))
      : [],
    periodCode,
  });
  return data;
}
