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
        // Widened from int to decimal(18,4) so FBR Annexure-A imports
        // can carry fractional quantities (chemicals/textiles/fuel) and
        // so the purchase side matches the sales side which already went
        // decimal in 20260429_AddDecimalQuantityAndUnitFlag. Hakimi-style
        // integer quantities round-trip cleanly. Existing callers that
        // pass this to int-typed APIs (e.g. IStockService.RecordMovement)
        // cast explicitly; no behaviour change for whole-number rows.
        public decimal Quantity { get; set; }
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

        // FBR Annexure-A line-level taxes that don't fit into the simple
        // GST rate × value model on PurchaseBill. Both nullable so they're
        // additive — manual purchases that don't carry these still work.
        //
        //  • ExtraTax           — additional FBR tax on items like sugar,
        //                          cement, 3rd Schedule goods.
        //  • StWithheldAtSource — sales-tax amount the buyer (us) had
        //                          withheld at source. Compliance-critical
        //                          for STRN holders.
        public decimal? ExtraTax { get; set; }
        public decimal? StWithheldAtSource { get; set; }

        // Navigation
        public PurchaseBill PurchaseBill { get; set; } = null!;
        public GoodsReceiptItem? GoodsReceiptItem { get; set; }
        public ItemType? ItemType { get; set; }

        /// <summary>
        /// Sale lines this purchase line covered (the "Purchase Against
        /// Sale Bill" flow). One PurchaseItem can cover MANY InvoiceItems
        /// because the operator groups sale lines by ItemType (e.g. 28
        /// "Medicines" lines collapsed into one Paracetamol procurement).
        /// </summary>
        public ICollection<PurchaseItemSourceLine> SourceLines { get; set; } = new List<PurchaseItemSourceLine>();
    }
}
