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
    // Rules (first match wins). Updated 2026-05-08 after the operator
    // confirmed their workflow:
    //   • ERP-first, IRIS-after — purchases are entered into our system
    //     BEFORE the monthly Sales Tax Return is filed. By the time FBR
    //     marks a row Status=Claimed, it's already in our PurchaseBills.
    //   • Therefore Status=Claimed is treated as a hard skip: no dedup
    //     check needed, the FBR field is the source of truth.
    //   • Status=Valid is the only status that flows through to the
    //     dedup + import path — those are the rows the operator hasn't
    //     yet acted on in IRIS.
    //   • Empty Product Description is NOT a skip — many small suppliers
    //     leave it blank, but the row still has HS Code + qty + value.
    //     Phase 2 will fall back to "HS {code}" for the ItemType name.
    //
    //   1. Invoice Type ≠ "Purchase Invoice"               → skip-wrong-type
    //   2. Status ∈ Cancelled/Rejected                     → skip-cancelled
    //   3. Status not Valid (i.e. Claimed/anything else)   → skip-already-claimed
    //   4. Taxpayer Type ≠ Registered (NTN=9999999999999) → skip-unregistered-seller
    //   5. HS Code blank or invalid (4-digit OR NNNN.NNNN) → skip-no-hs-code
    //   6. Quantity ≤ 0 or unparseable                     → skip-zero-qty
    //   7. Parser raised any per-row warning               → failed-validation
    //   else                                               → candidate
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

        public string? DecideOrCandidate(FbrPurchaseLedgerRow row)
        {
            // Rule 1 — Invoice Type
            if (!string.Equals(row.InvoiceType?.Trim(), "Purchase Invoice", StringComparison.OrdinalIgnoreCase))
                return ImportDecision.SkipWrongType;

            // Rule 2 — Cancelled / Rejected
            if (!string.IsNullOrWhiteSpace(row.Status) && CancelledStatuses.Contains(row.Status.Trim()))
                return ImportDecision.SkipCancelled;

            // Rule 3 — Status must be Valid. Anything else (Claimed,
            // Pending, Disputed, etc.) is implicitly already-handled in
            // the operator's ERP-first workflow.
            var statusTrim = row.Status?.Trim() ?? "";
            if (!string.Equals(statusTrim, "Valid", StringComparison.OrdinalIgnoreCase))
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
