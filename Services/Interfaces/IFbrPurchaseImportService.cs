using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// FBR Annexure-A purchase ledger importer. Phase 1 exposes only
    /// PreviewAsync (read-only, no DB writes); Phase 2 will add
    /// CommitAsync that turns previewed rows into real Suppliers /
    /// PurchaseBills / PurchaseItems / StockMovements.
    /// </summary>
    public interface IFbrPurchaseImportService
    {
        /// <summary>
        /// Parse the supplied .xls/.xlsx, run the locked filter rules,
        /// dedup against existing PurchaseBills, and return a per-row
        /// decision report. Caller is expected to have validated that
        /// the user has the import-preview permission and that the
        /// companyId belongs to the active tenant scope.
        /// </summary>
        Task<FbrImportPreviewResponse> PreviewAsync(
            Stream fileStream, string originalFileName, int companyId);

        /// <summary>
        /// Re-parse + re-filter the file (same code path as PreviewAsync
        /// — no preview state passed in, the file itself is the input)
        /// and execute write-side commits for every row tagged
        /// will-import or product-will-be-created. Per-invoice
        /// transactions; one bad invoice rolls back just itself.
        ///
        /// Side effects (per imported invoice):
        ///   • Supplier:     find-or-create by NTN within companyId scope
        ///                   (and join into the matching SupplierGroup)
        ///   • ItemType:     find-or-create per line; new rows from
        ///                   4-digit HS codes are flagged
        ///                   IsHsCodePartial=true to keep them out of
        ///                   sales until the operator picks a real PCT
        ///   • PurchaseBill: created with Source="fbr-import"
        ///   • StockMovement: Direction=In, sourceType=PurchaseBill —
        ///                   immediately makes the inventory available
        ///                   for sales
        ///
        /// Caller has already verified the fbrimport.purchase.commit
        /// permission. userId may be null (we still write — auditing
        /// degrades gracefully).
        /// </summary>
        Task<FbrImportCommitResponse> CommitAsync(
            Stream fileStream, string originalFileName, int companyId, int? userId);
    }
}
