namespace MyApp.Api.DTOs
{
    // ── FBR Purchase Import: Phase 2 (Commit) DTOs ──────────────────────
    //
    // Wire shape for /api/fbr-purchase-import/commit. Phase 2 is the
    // write path: re-parse the uploaded file, re-run the same filter
    // and matcher used by /preview, then for each row tagged
    //   • will-import           — match exists, just create the bill
    //   • product-will-be-created — auto-create ItemType, then create the bill
    // execute a per-invoice transaction that lands:
    //   1. Supplier (find-or-create by NTN, mirroring the Common
    //      Suppliers grouping the operator already uses for clients)
    //   2. ItemType per line (find-or-create; tagged IsHsCodePartial=true
    //      when the source HS code was only 4 digits — these rows are
    //      not sales-ready until the operator picks a full PCT)
    //   3. PurchaseBill + PurchaseItems
    //   4. StockMovement (Direction=In) per line — feeds the inventory
    //      ledger so the row is immediately available for sales pulls
    //
    // Each invoice's transaction is independent — a single broken
    // invoice rolls back just itself, not the whole batch. The result
    // surfaces per-invoice success/failure so the operator can fix the
    // source rows and re-upload.

    public class FbrImportCommitInvoiceResult
    {
        public string FbrInvoiceRefNo { get; set; } = "";
        public string SupplierNtn { get; set; } = "";
        public string SupplierName { get; set; } = "";
        public string InvoiceNo { get; set; } = "";

        // Outcome of THIS invoice's transaction:
        //   • imported     — successfully created bill + items + stock movements
        //   • skipped      — every line on this invoice resolved to a skip
        //                    decision (already-claimed, already-exists, etc.)
        //   • failed       — transaction rolled back due to a runtime error
        public string Outcome { get; set; } = "";
        public int? CreatedPurchaseBillId { get; set; }
        public int LineCount { get; set; }
        public string? ErrorMessage { get; set; }
    }

    public class FbrImportCommitCounts
    {
        // Invoice-level
        public int InvoicesImported { get; set; }
        public int InvoicesSkipped { get; set; }
        public int InvoicesFailed { get; set; }

        // Side effects
        public int SuppliersCreated { get; set; }
        public int ItemTypesCreated { get; set; }
        public int LinesImported { get; set; }
        public int StockMovementsRecorded { get; set; }

        // Carried forward from the preview so the result page can show
        // the same summary chips next to "what got committed".
        public FbrImportDecisionCounts PreviewDecisionCounts { get; set; } = new();
    }

    public class FbrImportCommitResponse
    {
        public string FileName { get; set; } = "";
        public int CompanyId { get; set; }
        public DateTime CommittedAt { get; set; }
        public int? CommittedByUserId { get; set; }

        public FbrImportCommitCounts Counts { get; set; } = new();

        // Per-invoice outcomes — useful for the result page so the
        // operator can see "this invoice failed because supplier X
        // already had an open bill with a conflicting amount".
        public List<FbrImportCommitInvoiceResult> Invoices { get; set; } = new();

        // Workbook-level warnings (sheet missing, header missing, etc.)
        // — same shape as preview so the result page renders them
        // identically.
        public List<string> Warnings { get; set; } = new();
    }
}
