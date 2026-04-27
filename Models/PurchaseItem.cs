namespace MyApp.Api.Models
{
    /// <summary>
    /// Mirror of <see cref="InvoiceItem"/> for the purchase side. One line
    /// on a supplier's invoice — quantity received, unit cost, tax breakdown.
    /// Same FBR fields as the sales side because the supplier's invoice
    /// has the same structure under V1.12.
    /// </summary>
    public class PurchaseItem
    {
        public int Id { get; set; }
        public int PurchaseBillId { get; set; }
        public int? GoodsReceiptItemId { get; set; }

        /// <summary>
        /// Link to the shared <see cref="ItemType"/> catalog. Same item
        /// rows the sales side uses — when "Pneumatic Items" appears on a
        /// PurchaseBill and an Invoice, both reference the same ItemType,
        /// which is what makes inventory tracking possible.
        /// </summary>
        public int? ItemTypeId { get; set; }

        public string ItemTypeName { get; set; } = "";
        public string Description { get; set; } = "";
        public int Quantity { get; set; }
        public string UOM { get; set; } = "";
        public decimal UnitPrice { get; set; }
        public decimal LineTotal { get; set; }

        // FBR fields — captured from supplier's invoice for parity.
        public string? HSCode { get; set; }
        public int? FbrUOMId { get; set; }
        public string? SaleType { get; set; }
        public int? RateId { get; set; }
        public decimal? FixedNotifiedValueOrRetailPrice { get; set; }
        public string? SroScheduleNo { get; set; }
        public string? SroItemSerialNo { get; set; }

        // Navigation
        public PurchaseBill PurchaseBill { get; set; } = null!;
        public GoodsReceiptItem? GoodsReceiptItem { get; set; }
        public ItemType? ItemType { get; set; }
    }
}
