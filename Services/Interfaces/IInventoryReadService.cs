namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// One item type's inventory position under the V2 derived read model.
    /// The logical buckets (Committed / ToDeliver / Delivered / Incoming) are
    /// NEVER persisted — they are computed at query time from the open
    /// documents that define them, so nothing can drift out of sync with the
    /// documents. Physical OnHand still comes from the StockMovement ledger.
    /// </summary>
    public class InventoryBucketRow
    {
        public int ItemTypeId { get; set; }
        public string ItemTypeName { get; set; } = "";
        public string? HSCode { get; set; }
        public string? UOM { get; set; }

        /// <summary>Whether this item participates in inventory for the company
        /// (per its InventoryFlowVersion + any CompanyItemTypeSetting override).</summary>
        public bool Tracked { get; set; }

        /// <summary>Physical stock in hand = opening + Σ In − Σ Out (ledger).</summary>
        public decimal OnHand { get; set; }

        /// <summary>Open sales-order quantity not yet delivered or directly
        /// invoiced = Σ max(ordered − delivered − directInvoiced, 0).</summary>
        public decimal ToDeliver { get; set; }

        /// <summary>Delivered (on a challan) but not yet billed — physical stock
        /// still on hand until the bill records the OUT.</summary>
        public decimal Delivered { get; set; }

        /// <summary>Total reserved against customers = ToDeliver + Delivered.</summary>
        public decimal Committed { get; set; }

        /// <summary>Free to sell = OnHand − Committed (may be negative → shortage).</summary>
        public decimal Available { get; set; }

        /// <summary>Inbound on un-billed goods receipts (visibility only; IN
        /// posts at Purchase Bill).</summary>
        public decimal Incoming { get; set; }

        public decimal? ReorderLevel { get; set; }
        public DateTime? LastMovementAt { get; set; }
    }

    /// <summary>
    /// Read-only projection of inventory buckets from live document state
    /// (the derived read model). This is the single place bucket math lives —
    /// the ItemType inventory summary and the availability guard both read it,
    /// so a document edit/cancel/delete is reflected on the next read with
    /// nothing to reconcile.
    /// </summary>
    public interface IInventoryReadService
    {
        /// <summary>
        /// Compute inventory buckets for a company. When
        /// <paramref name="itemTypeIds"/> is null, every item type with any
        /// inventory activity (opening / movement / open SO / un-billed challan
        /// / un-billed GR) is included. <paramref name="allowedDivisionIds"/>
        /// is the division-RBAC scope (null = unrestricted; otherwise
        /// company-level rows plus the listed divisions, policy D1).
        /// </summary>
        Task<List<InventoryBucketRow>> GetBucketsAsync(
            int companyId,
            IEnumerable<int>? itemTypeIds = null,
            HashSet<int>? allowedDivisionIds = null);

        /// <summary>
        /// Available-to-sell for one item = OnHand − Committed. Used by the
        /// over-commit guard. Same derived math as <see cref="GetBucketsAsync"/>
        /// for a single item.
        /// </summary>
        Task<decimal> GetAvailableAsync(
            int companyId,
            int itemTypeId,
            HashSet<int>? allowedDivisionIds = null);
    }
}
