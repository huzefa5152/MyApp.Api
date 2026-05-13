# Tax-Optimization Gate — Feature Brief

**Owner:** Huzefa
**Researched:** 2026-05-14 (in the Claude Code session that shipped
`a91d03e` — shared ItemTypeForm + UOM autocomplete + HS-lock UX).
**Status:** Approved for build. Not started.

---

## Goal

Force operators to **review the tax-claim optimization on every FBR-bound
bill before they can Validate / Submit it**, and surface how much tax
they're saving (or could save) by adjusting filed quantities against
purchase-side input-tax credit.

The mechanics already exist (the `InvoiceItemAdjustment` overlay + the
dual-book "real bill vs FBR filing" split + `TaxClaimService.GetClaimSummaryAsync`);
this feature is the **workflow gate, UX surface, and bulk-flow
alignment** on top of those.

---

## What's already shipped (don't re-build)

| Piece | Lives in |
|---|---|
| `InvoiceItemAdjustment` table — per-line overlay with `AdjustedQuantity`, `AdjustedUnitPrice`, `AdjustedHSCode`, etc.; null = "use real value" | `Models/InvoiceItemAdjustment.cs` |
| Bill print uses real `InvoiceItem`; FBR submit / tax-claim math reads overlay when present | already in `FbrService`, `InvoiceService.SyncInvoiceStockMovementsAsync` |
| `TaxClaimService.GetClaimSummaryAsync` — Phase-B claim summary (§8A aging, §8B 90% cap, IRIS reconciliation filter, carry-forward proxy) | `Services/Implementations/TaxClaimService.cs` |
| `TaxClaimService.GetHsStockSummaryAsync` — HS-code stock left after sales OUT | same file |
| `Reason = "tax-claim-optimization" / "manual-fbr-tweak"` on overlay rows so operator vs system overlays are distinguishable | overlay model |

---

## Approved decisions (locked in)

1. **Gate flavor: option (b) — permissive.** Block Validate/Submit only on bills where there's genuine tax savings to capture. If the optimization computes Rs. 0 improvement, the gate auto-passes silently. Operators don't get badgered on already-optimal bills.
2. **All lines must carry an HS code** to be eligible for Validate/Submit — *not* "at least one". A bill with even one HS-less line is blocked with a clear error: "Line N has no HS code — pick one to enable FBR submission." This is a precondition for the gate.
3. **"Skip optimization" action is allowed** — operator's call when they don't want to claim (or there's no matching purchase stock). Gated by `invoices.fbr.submit` so only FBR-trusted users can dismiss. Records a row marker so we know it was explicitly skipped (not just forgotten).
4. **Already-submitted bills are grandfathered.** No retroactive gate, no badge, no comparison view button. The feature applies only to bills that still need FBR submission.

---

## What's net-new

### 1. Per-bill "reviewed" gate
- Add `TaxOptimizationReviewedAt` (nullable `DateTime`) on `Invoice`.
- Set automatically when an overlay row is created (operator applied the suggestion).
- Set explicitly when operator clicks "Skip optimization" (with a `TaxOptimizationSkippedAt` companion or a `Reason` column on the same field — design call at build time).
- Server-side check in `FbrService.ValidateInvoiceAsync` + `SubmitInvoiceAsync` + bulk paths:
  - If **any line has no HS code** → 400 "Pick HS code on every line before submitting."
  - Else if `TaxClaimService.GetClaimSummaryAsync(invoice)` says `savedRs > 0` AND `TaxOptimizationReviewedAt == null` → 409 "Quantity not adjusted against this HS code. Review the optimization or click Skip."
  - Else pass.
- Doesn't apply to `IsDemo` bills or already-submitted bills.

### 2. Status badge + Invoices-tab filter
- New computed field on `InvoiceDto`: `TaxOptimizationStatus` with values:
  - `"Optimal"` — savings = 0, gate auto-passes
  - `"Adjusted"` — overlay exists, gate passes
  - `"Skipped"` — explicitly skipped, gate passes
  - `"NotAdjusted"` — savings > 0 AND no overlay AND not skipped → gate blocks
  - `"NotApplicable"` — missing HS code, demo, or already submitted
- Returned in the same payload the Invoices list already fetches — zero extra round-trips.
- New filter chip: "Needs adjustment" filters by `NotAdjusted` so operators see exactly the pile they need to act on.

### 3. Preview "savings" line
- Server: `/api/fbr/{invoiceId}/preview-payload` adds a `taxSavings` block to the response:
  ```json
  "taxSavings": {
    "actualTaxRs": 12000,
    "adjustedTaxRs": 7725,
    "savedRs": 4275,
    "linesAdjusted": 3
  }
  ```
- Bulk preview (`BulkFbrPreviewDialog`) gets a totals strip: "Filing N bills · saving Rs. X across M adjusted lines."
- Frontend renders a green pill on the per-bill preview card.

### 4. Per-invoice tax comparison view
- New endpoint: `GET /api/invoices/{id}/tax-optimization-comparison`.
- Response shape:
  ```json
  {
    "perLine": [
      {
        "line": 1, "hsCode": "8481.8090",
        "actualQty": 1, "actualUnitPrice": 33800, "actualLineTax": 6084,
        "adjustedQty": 104, "adjustedUnitPrice": 325, "adjustedLineTax": 6084,
        "purchaseInputTaxAvailable": 6084,
        "claimableActual": 0, "claimableAdjusted": 6084, "deltaRs": 6084
      }
    ],
    "totals": {
      "actualTaxRs": 12000, "adjustedTaxRs": 7725, "savedRs": 4275
    }
  }
  ```
- Frontend modal triggered from a **"Tax view"** button on each bill card AND in the bill edit drawer. Two-column layout (real bill | FBR filing) with the delta strip in the middle.

### 5. Bulk validate / submit alignment
- `FbrSandboxController.ValidateAll/SubmitAll` + the production bulk endpoints pre-filter bills by the gate.
- Bulk preview dialog surfaces *"3 bills skipped — review optimization or skip explicitly"* with a "Review now" link that opens the comparison view on the first skipped bill.
- "Submit-All" button itself shows a count: *"Submit-All (12 ready, 3 blocked)"* so the operator knows what's about to fly.

---

## Implementation sequence (1.5 days)

| # | Step | Effort | Risk |
|---|---|---|---|
| 1 | Schema: `Invoice.TaxOptimizationReviewedAt` + idempotent startup SQL (no formal migration) | 30 min | low |
| 2 | `TaxClaimService.ComputeBillOptimizationAsync(invoiceId)` returning `{savedRs, perLineSavings, recommendedOverlays}` if not already there | 1-2 hr | low |
| 3 | Gate in `FbrService.ValidateInvoiceAsync` + `SubmitInvoiceAsync` + bulk endpoints; clear error messages | 2-3 hr | low |
| 4 | DTO change: `TaxOptimizationStatus` computed field; status badge + filter chip in Invoices tab | 2-3 hr | low |
| 5 | "Skip optimization" action — new endpoint + UI button on the bill card (gated by `invoices.fbr.submit`) | 1 hr | low |
| 6 | Preview "savings" block — server + UI render | 1-2 hr | low |
| 7 | Comparison view endpoint + modal — two-column layout | 4-6 hr | medium (mostly UI polish) |
| 8 | Bulk validate/submit pre-filter + "(N ready, M blocked)" surfacing | 1-2 hr | low |
| 9 | Tests in `scripts/test_basic_flows.py` covering all 5 status transitions | 1 hr | low |

**Total: ~10–12 hours of focused work, splittable across two sessions.**

---

## Pre-commit gates (run these before push)

```bash
dotnet build MyApp.Api.csproj                                # 0 errors
python scripts/verify_audit_2026_05_13_security.py           # 67/67 static
python scripts/verify_audit_2026_05_13_security.py --live    # 73/73 live
python scripts/test_basic_flows.py                           # 30/30 (currently)
```

Add to `test_basic_flows.py` for this feature:
- Bill with all-HS-coded lines + no overlay + savings > 0 → Validate returns 409 "Quantity not adjusted"
- Same bill after `POST /api/invoices/{id}/skip-tax-optimization` → Validate passes
- Same bill after applying overlay → Validate passes
- Bill with one HS-less line → Validate returns 400 "Pick HS code on every line"
- Bill with savings = 0 → Validate passes without operator action

---

## How to start tomorrow's session

Use this command to load the research and start work:

```
Read FEATURE_TAX_OPTIMIZATION_GATE.md, treat it as approved spec, and
implement step-by-step. Commit each step separately. Don't push until
I've verified locally. Start with step 1 (schema migration) and work
down. Stop and ask me before touching anything that isn't in the spec.
```

Or shorter:

```
/implement FEATURE_TAX_OPTIMIZATION_GATE.md
```

(If `/implement` isn't a recognised skill, Claude will just read the
file and proceed — same result.)
