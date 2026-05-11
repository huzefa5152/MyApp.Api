using MyApp.Api.Models;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// Inventory accounting for the purchase + sales modules. All stock state
    /// derives from the append-only <see cref="StockMovement"/> log: on-hand =
    /// Σ In − Σ Out + opening balance. The service is the only writer.
    ///
    /// Tracking is opt-in per Company via
    /// <c>Company.InventoryTrackingEnabled</c>. While off:
    ///   • <see cref="RecordMovementAsync"/> is a no-op
    ///   • <see cref="CheckAvailabilityAsync"/> always reports "available"
    ///   • Reads still return real numbers (so the dashboard works the
    ///     instant the flag is flipped on, given existing OpeningBalance rows)
    /// </summary>
    public interface IStockService
    {
        /// <summary>
        /// Whether the company has inventory tracking turned on. Hot-path
        /// gate for callers that want to skip work when it's off.
        /// </summary>
        Task<bool> IsTrackingEnabledAsync(int companyId);

        /// <summary>
        /// Append a movement to the log. No-op if tracking is disabled for
        /// the company OR if itemTypeId is null (we can't track lines that
        /// aren't bound to a catalog row). Quantity must be positive — the
        /// sign comes from <paramref name="direction"/>.
        /// </summary>
        Task RecordMovementAsync(
            int companyId,
            int itemTypeId,
            StockMovementDirection direction,
            int quantity,
            StockMovementSourceType sourceType,
            int? sourceId,
            DateTime movementDate,
            string? notes = null);

        /// <summary>
        /// Current on-hand for one item under one company. Computed as
        /// opening balance + Σ In − Σ Out across all movements up to
        /// <paramref name="asOfDate"/> (default: now). Returns 0 when no
        /// data exists. Reads work even when tracking is disabled.
        /// </summary>
        Task<int> GetOnHandAsync(int companyId, int itemTypeId, DateTime? asOfDate = null);

        /// <summary>
        /// Bulk on-hand lookup — same math as <see cref="GetOnHandAsync"/>
        /// but for many items at once. Returns a dictionary keyed by
        /// itemTypeId; missing keys mean "no data, treat as 0".
        /// </summary>
        Task<Dictionary<int, int>> GetOnHandBulkAsync(
            int companyId,
            IEnumerable<int> itemTypeIds,
            DateTime? asOfDate = null);

        /// <summary>
        /// Pre-flight check used by FBR submission: do we have enough stock
        /// to cover every line on this invoice? Lines without an
        /// ItemTypeId are skipped (we can't track them, so we don't block
        /// on them). Returns a per-shortage list — empty = good to go.
        ///
        /// When tracking is disabled, returns no shortages regardless of
        /// numbers (the operator hasn't opted in yet).
        /// </summary>
        Task<List<StockShortage>> CheckAvailabilityAsync(
            int companyId,
            IEnumerable<StockRequirement> required);

        /// <summary>
        /// Idempotently sync the StockMovement rows for a single Invoice
        /// against its current Items. Deletes any existing
        /// (SourceType=Invoice, SourceId=invoice.Id) movements and
        /// re-inserts fresh "Out" movements for every line bound to a
        /// catalog ItemType.
        ///
        /// Quantity policy (2026-05-12): when an InvoiceItemAdjustment
        /// overlay carries an AdjustedQuantity for the line, THAT value
        /// is used — i.e. the FBR-facing decomposition (e.g. 116) drives
        /// the deduction, not the printed bill's row qty (e.g. 1). This
        /// keeps the operator's stock ledger consistent with what was
        /// reported to FBR: a tax-claim split into 116 units removes 116
        /// from inventory, just as the FBR side records 116. Lines with
        /// no overlay use the bill row's Quantity directly.
        ///
        /// Called from every invoice save path (create / update / narrow
        /// edit). Replaces the old "emit on FBR submit" trigger so the
        /// stock dashboard and the availability pre-flight see the
        /// deduction the instant a bill is saved — the next bill picking
        /// the same Item Type sees reduced on-hand without having to wait
        /// for FBR submission.
        ///
        /// No-op when inventory tracking is disabled for the company.
        /// Must run inside the caller's transaction for atomicity.
        ///
        /// 2026-05-12: added; quantity-source flipped to overlay-first.
        /// </summary>
        Task SyncInvoiceStockMovementsAsync(Models.Invoice invoice);
    }

    /// <summary>One item demand on a bill: how much do we need.</summary>
    public record StockRequirement(int ItemTypeId, string ItemName, int Quantity);

    /// <summary>One shortfall reported by <see cref="IStockService.CheckAvailabilityAsync"/>.</summary>
    public record StockShortage(
        int ItemTypeId,
        string ItemName,
        int RequiredQuantity,
        int OnHandQuantity,
        int ShortBy);
}
