namespace MyApp.Api.Models
{
    /// <summary>
    /// Mirror of <see cref="DeliveryChallan"/> for the purchase side — the
    /// warehouse acknowledgement that goods physically arrived. Distinct
    /// from <see cref="PurchaseBill"/> because the bill is a finance/tax
    /// document while the receipt is an operations document. They CAN be
    /// 1:1 (most common) or N:1 (multiple deliveries against one bill) or
    /// 1:N (one delivery covers items from multiple bills) — same as
    /// challans/invoices on the sales side.
    /// </summary>
    public class GoodsReceipt
    {
        public int Id { get; set; }
        public int GoodsReceiptNumber { get; set; }
        public DateTime ReceiptDate { get; set; }
        public int CompanyId { get; set; }
        /// <summary>Optional division ("sub-company"); when set the GRN numbers
        /// from the division's own sequence. Null = company-level.</summary>
        public int? DivisionId { get; set; }
        public int SupplierId { get; set; }
        public int? PurchaseBillId { get; set; }

        /// <summary>
        /// Supplier's delivery / dispatch reference number on the printed
        /// challan that came with the goods. Free text — used when
        /// reconciling against the supplier's records.
        /// </summary>
        public string? SupplierChallanNumber { get; set; }
        public string? Site { get; set; }

        /// <summary>
        /// Pending / Cancelled — same lifecycle states as DeliveryChallan
        /// but on the receiving side. A cancelled receipt does NOT trigger
        /// a stock IN movement.
        /// </summary>
        public string Status { get; set; } = "Pending";

        /// <summary>
        /// Copy lineage (2026-08-28): the document this row was created from via
        /// the Copy Document action, as a (type, id) pair —
        /// <see cref="Helpers.DocumentCopyTypes"/> holds the allowed type values.
        /// Deliberately NOT a foreign key: the source may be a different entity
        /// (a Purchase Bill copied into a Goods Receipt), so no single navigation
        /// fits, and deleting the source must never cascade into the copy. Null
        /// on documents that were not created by a copy.
        /// </summary>
        public string? CopiedFromType { get; set; }
        public int? CopiedFromId { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Navigation
        public Company Company { get; set; } = null!;
        public Division? Division { get; set; }
        public Supplier Supplier { get; set; } = null!;
        public PurchaseBill? PurchaseBill { get; set; }
        public ICollection<GoodsReceiptItem> Items { get; set; } = new List<GoodsReceiptItem>();
    }
}
