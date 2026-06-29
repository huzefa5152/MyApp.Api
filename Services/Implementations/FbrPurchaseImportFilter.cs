using System.Text.RegularExpressions;
using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Implementations
{
    // ── FBR Purchase Import Filter ──────────────────────────────────────
    //
    // Applies the per-row skip rules in the documented order. Each row
    // either gets a "skip-*" tag, "failed-validation", or stays
    // "candidate" (meaning it survives filtering and goes to the
    // matcher for dedup + product lookup).
    //
    // Rules (first match wins). Updated 2026-06-29 — the original
    // 2026-05-08 "ERP-first" assumption (every Status=Claimed row is
    // already in our PurchaseBills, so hard-skip it) turned out to be
    // wrong: some Claimed rows were submitted/claimed at FBR but never
    // entered in our system. So Claimed no longer hard-skips — it flows
    // to the dedup matcher exactly like Valid:
    //   • If the matcher finds the purchase bill already in our system
    //     → already-exists ("Already in ERP").
    //   • If not → will-import / product-will-be-created.
    // This way the operator is told "already in the system" for the ones
    // we have, and can import the ones we're missing.
    //
    //   • Status=Valid AND Status=Claimed flow through to dedup + import.
    //   • Status ∈ Cancelled/Rejected are hard-skipped (voided rows).
    //   • Any other status (Pending/Disputed/…) stays a hard skip
    //     (skip-already-claimed) — not actionable until FBR finalises it.
    //   • Empty Product Description is NOT a skip — many small suppliers
    //     leave it blank, but the row still has HS Code + qty + value.
    //     The committer falls back to "HS {code}" for the ItemType name.
    //
    //   1. Invoice Type ≠ "Purchase Invoice"               → skip-wrong-type
    //   2. Status ∈ Cancelled/Rejected                     → skip-cancelled
    //   3. Status ∉ {Valid, Claimed}                       → skip-already-claimed
    //   4. Taxpayer Type ≠ Registered (NTN=9999999999999) → skip-unregistered-seller
    //   5. HS Code blank or invalid (4-digit OR NNNN.NNNN) → skip-no-hs-code
    //   6. Quantity ≤ 0 or unparseable                     → skip-zero-qty
    //   7. Parser raised any per-row warning               → failed-validation
    //   else                                               → candidate (→ matcher dedup)
    //
    // The dedup + product lookup live in the matcher, not here, so this
    // class stays a pure function of the row + spec — testable without
    // hitting the database.

    public interface IFbrPurchaseImportFilter
    {
        /// <summary>
        /// Returns the decision for the row, or null if the row passed
        /// every filter and is a candidate for the matcher.
        /// </summary>
        string? DecideOrCandidate(FbrPurchaseLedgerRow row);
    }

    public class FbrPurchaseImportFilter : IFbrPurchaseImportFilter
    {
        // Pakistan FBR HS codes appear in two forms on Annexure-A:
        //   • NNNN          — HS heading. Broad family (e.g. "8301" =
        //                     padlocks/locks/keys). Common when small
        //                     suppliers file simplified invoices.
        //   • NNNN.NNNN     — PCT (Pakistan Customs Tariff). Full
        //                     specificity. Required for industrial
        //                     suppliers / large invoices.
        // We accept both — matcher does exact-string lookup, so "8301"
        // never accidentally matches an ItemType with "8301.1000". When
        // Phase 2 auto-creates ItemTypes it persists the code as-is, so
        // a row with "8301" makes one ItemType and a row with "8301.1000"
        // makes a different one. Operator can merge them later via a
        // separate admin action.
        //
        // Longer / non-standard formats (e.g. 6-digit straight, 11-char
        // sub-PCT) get caught by this regex and surfaced as
        // skip-no-hs-code; relax further if FBR ever emits those.
        private static readonly Regex HsCodeRx = new(@"^\d{4}(\.\d{4})?$", RegexOptions.Compiled);

        // Statuses we treat as "voided / inactive". FBR's Annexure-A
        // doesn't always emit these (most rows are Claimed or Valid),
        // but we defensively skip them so a future export that includes
        // historical Cancelled rows doesn't accidentally import them.
        private static readonly HashSet<string> CancelledStatuses = new(StringComparer.OrdinalIgnoreCase)
        {
            "Cancelled",
            "Rejected",
        };

        // Statuses that are actionable — they flow through to the dedup
        // matcher which decides already-exists vs will-import. "Valid" =
        // not yet acted on in IRIS; "Claimed" = submitted/claimed at FBR
        // but possibly not yet in our system (see header note 2026-06-29).
        private static readonly HashSet<string> ImportableStatuses = new(StringComparer.OrdinalIgnoreCase)
        {
            "Valid",
            "Claimed",
        };

        public string? DecideOrCandidate(FbrPurchaseLedgerRow row)
        {
            // Rule 1 — Invoice Type
            if (!string.Equals(row.InvoiceType?.Trim(), "Purchase Invoice", StringComparison.OrdinalIgnoreCase))
                return ImportDecision.SkipWrongType;

            // Rule 2 — Cancelled / Rejected
            if (!string.IsNullOrWhiteSpace(row.Status) && CancelledStatuses.Contains(row.Status.Trim()))
                return ImportDecision.SkipCancelled;

            // Rule 3 — Status must be actionable (Valid or Claimed).
            // Claimed rows are dedup-checked downstream: already-exists if
            // we have them, will-import if we don't (2026-06-29). Other
            // statuses (Pending, Disputed, etc.) stay skipped.
            var statusTrim = row.Status?.Trim() ?? "";
            if (!ImportableStatuses.Contains(statusTrim))
                return ImportDecision.SkipAlreadyClaimed;

            // Rule 4 — Seller must be Registered. Unregistered carry the
            // FBR placeholder NTN 9999999999999, can't claim input tax
            // against them, and would poison the supplier + ItemType
            // catalogs if auto-imported.
            var taxpayerTrim = row.TaxpayerType?.Trim() ?? "";
            if (!string.Equals(taxpayerTrim, "Registered", StringComparison.OrdinalIgnoreCase))
                return ImportDecision.SkipUnregisteredSeller;

            // Rule 5 — HS Code (accepts NNNN or NNNN.NNNN)
            if (string.IsNullOrWhiteSpace(row.HsCode) || !HsCodeRx.IsMatch(row.HsCode.Trim()))
                return ImportDecision.SkipNoHsCode;

            // Rule 6 — Quantity. Null means unparseable (parser will have
            // already raised a warning); ≤ 0 is the explicit zero/negative
            // check from the spec.
            if (row.Quantity is null or <= 0)
                return ImportDecision.SkipZeroQty;

            // No description filter — empty is acceptable. Phase 2 will
            // create ItemType.Name = "HS {code}" when description is blank.

            // Rule 7 — soft-fails surfaced by the parser. Even if Date
            // didn't parse the row passed all hard filters above, but we
            // still don't want to import it. failed-validation surfaces
            // it loudly to the operator.
            if (row.ParseWarnings.Count > 0)
                return ImportDecision.FailedValidation;

            return null; // candidate — falls through to the matcher
        }
    }
}
