namespace MyApp.Api.DTOs
{
    // ── FBR Purchase Import: Phase 1 (Preview) DTOs ─────────────────────
    //
    // Wire shape for /api/fbr-purchase-import/preview. Phase 1 is read-
    // only: parse → filter → dedup-check → return per-row decisions.
    // Nothing in this file maps to a database write yet — Phase 2 adds
    // commit DTOs that reuse most of these names.

    /// <summary>
    /// Decision the import service made about each invoice / line. The
    /// frontend uses this string to colour-code the preview row and group
    /// by "will-import / already-exists / skip-* / failed-validation".
    /// </summary>
    public static class ImportDecision
    {
        // Imports
        public const string WillImport       = "will-import";
        public const string ProductWillCreate = "product-will-be-created";

        // Skips
        public const string AlreadyExists    = "already-exists";
        // Status=Claimed in FBR Annexure-A — operator's workflow is ERP-
        // first, IRIS-after, so a Claimed row is already in our books
        // by definition. Skip without running dedup. Conceptually
        // similar to AlreadyExists but the signal source is the FBR
        // Status field, not a row match in our PurchaseBills table.
        public const string SkipAlreadyClaimed = "skip-already-claimed";
        // FBR's Taxpayer Type ≠ Registered. Unregistered sellers carry
        // placeholder NTN 9999999999999 and their invoices aren't
        // input-tax-claimable. Auto-importing them would pollute both
        // the supplier list (one fake supplier collapses N transactions)
        // and the ItemType catalog (with placeholder-pedigree products).
        public const string SkipUnregisteredSeller = "skip-unregistered-seller";
        public const string SkipCancelled    = "skip-cancelled";
        public const string SkipWrongType    = "skip-wrong-type";
        public const string SkipNoHsCode     = "skip-no-hs-code";
        public const string SkipZeroQty      = "skip-zero-qty";
        // Kept in the constants so external consumers don't break, but
        // the filter no longer emits this — empty descriptions are valid
        // (Phase 2 will create ItemType.Name = "HS {code}" as fallback).
        public const string SkipNoDescription = "skip-no-description";

        // Errors
        public const string FailedValidation = "failed-validation";
    }

    /// <summary>
    /// Aggregate decision counts shown as chips at the top of the
    /// preview screen. Field names match ImportDecision constants 1:1
    /// (camelCased on the wire) so the frontend can render them
    /// generically.
    /// </summary>
    public class FbrImportDecisionCounts
    {
        public int WillImport { get; set; }
        public int ProductWillCreate { get; set; }
        public int AlreadyExists { get; set; }
        public int SkipAlreadyClaimed { get; set; }
        public int SkipUnregisteredSeller { get; set; }
        public int SkipCancelled { get; set; }
        public int SkipWrongType { get; set; }
        public int SkipNoHsCode { get; set; }
        public int SkipZeroQty { get; set; }
        public int SkipNoDescription { get; set; }
        public int FailedValidation { get; set; }
    }

    public class FbrImportPreviewSummary
    {
        public string FileName { get; set; } = "";
        public int CompanyId { get; set; }
        public int TotalRows { get; set; }
        public int TotalInvoices { get; set; }
        public FbrImportDecisionCounts DecisionCounts { get; set; } = new();
    }

    /// <summary>
    /// One line on a parsed invoice. Carries everything the operator
    /// needs to decide whether the row is OK to import — original FBR
    /// values, the matched ItemType (if any), and the per-line decision.
    /// </summary>
    public class FbrImportPreviewLineDto
    {
        // 1-based row number in the source spreadsheet (header is row 1,
        // first data row is row 2, etc.). Helps the operator grep back
        // into the file when they see a flagged row.
        public int SourceRowNumber { get; set; }

        public string HsCode { get; set; } = "";
        public string Description { get; set; } = "";
        public decimal Quantity { get; set; }
        public string Uom { get; set; } = "";
        public decimal ValueExclTax { get; set; }
        public decimal? GstRate { get; set; }
        public decimal? GstAmount { get; set; }
        public decimal? ExtraTax { get; set; }
        public decimal? StWithheldAtSource { get; set; }
        public decimal? FixedNotifiedValueOrRetailPrice { get; set; }
        public string? SaleType { get; set; }
        public string? SroScheduleNo { get; set; }
        public string? SroItemSerialNo { get; set; }

        // Match outcome. Both null means a brand-new product would be
        // created on commit — exactly the moment Phase 2's product
        // auto-creation kicks in.
        public int? MatchedItemTypeId { get; set; }
        public string? MatchedItemTypeName { get; set; }
        public string MatchedBy { get; set; } = "";  // hs-code | description | none

        public string Decision { get; set; } = "";
    }

    /// <summary>
    /// One invoice as the importer would create it on commit. Lines are
    /// the rows that share a base invoice number (FBR appends -1/-2/...
    /// suffixes for line items; we strip those and group).
    ///
    /// Decision at the invoice level is the AGGREGATE — if any line is
    /// will-import the whole invoice is will-import, else it surfaces
    /// the most common skip reason among its lines.
    /// </summary>
    public class FbrImportPreviewInvoiceDto
    {
        public string FbrInvoiceRefNo { get; set; } = "";
        public string SupplierNtn { get; set; } = "";
        public string SupplierName { get; set; } = "";
        public string InvoiceNo { get; set; } = "";          // base, suffix stripped
        public DateTime? InvoiceDate { get; set; }
        public decimal TotalValueExclTax { get; set; }
        public decimal TotalGstAmount { get; set; }
        public decimal TotalGrossValue { get; set; }

        public int? MatchedSupplierId { get; set; }
        public int? MatchedPurchaseBillId { get; set; }       // non-null when AlreadyExists

        public List<FbrImportPreviewLineDto> Lines { get; set; } = new();
        public string Decision { get; set; } = "";
    }

    /// <summary>
    /// Top-level response. Frontend renders summary chips, an invoice
    /// list (each expandable to show lines), and a Warnings section for
    /// out-of-band issues that didn't fit a per-row decision (header
    /// missing, sheet missing, etc.).
    /// </summary>
    public class FbrImportPreviewResponse
    {
        public FbrImportPreviewSummary Summary { get; set; } = new();
        public List<FbrImportPreviewInvoiceDto> Invoices { get; set; } = new();
        public List<string> Warnings { get; set; } = new();
    }
}
