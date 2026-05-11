namespace MyApp.Api.Models
{
    public class InvoiceItem
    {
        public int Id { get; set; }
        public int InvoiceId { get; set; }
        public int? DeliveryItemId { get; set; }

        /// <summary>
        /// Direct link to the ItemType (FBR-mapped product). Changing this on a
        /// bill overrides whatever type was set on the source delivery item, and
        /// auto-applies the ItemType's HS Code / UOM / Sale Type to this line.
        /// This lets users correct FBR classification at bill time without
        /// having to re-open the challan.
        /// </summary>
        public int? ItemTypeId { get; set; }

        public string ItemTypeName { get; set; } = "";
        public string Description { get; set; } = "";
        /// <summary>
        /// Stored as decimal(18,4) so fractional UOMs (KG, Liter, Carat, etc.)
        /// can carry up to 4 decimal places of precision. Whether the input
        /// form actually permits decimals depends on the picked UOM's
        /// AllowsDecimalQuantity flag — server-side validation rejects
        /// non-integer quantities on integer-only UOMs as defence in depth.
        /// </summary>
        public decimal Quantity { get; set; }
        public string UOM { get; set; } = "";
        public decimal UnitPrice { get; set; }
        public decimal LineTotal { get; set; }

        // FBR Digital Invoicing
        public string? HSCode { get; set; }
        public int? FbrUOMId { get; set; }
        public string? SaleType { get; set; }
        public int? RateId { get; set; }

        /// <summary>
        /// Printed MRP × quantity for 3rd Schedule goods (SN008 / SN027).
        /// When SaleType = "3rd Schedule Goods", FBR requires this to be > 0 and
        /// the sales tax must be backed OUT of this retail price using the
        /// formula: salesTax = retailPrice × rate ÷ (1 + rate).
        /// Null for non-3rd-schedule items (FBR accepts 0.00 there).
        /// </summary>
        public decimal? FixedNotifiedValueOrRetailPrice { get; set; }

        /// <summary>
        /// FBR SRO / Schedule reference for reduced-rate or exempt items. FBR
        /// rejects non-18% submissions with [0077] unless this is populated.
        /// Common values: "EIGHTH SCHEDULE Table 1", "SRO 297(I)/2023".
        /// Null for standard-rate items.
        /// </summary>
        public string? SroScheduleNo { get; set; }

        /// <summary>
        /// Serial No. from the referenced SRO/Schedule's item table. FBR
        /// rejects with [0078] if SroScheduleNo is set but this is missing
        /// or invalid. Values are lookups from PRAL's sroitemcodes API.
        /// </summary>
        public string? SroItemSerialNo { get; set; }

        // Navigation
        public Invoice Invoice { get; set; } = null!;
        public DeliveryItem? DeliveryItem { get; set; }
        public ItemType? ItemType { get; set; }
        /// <summary>
        /// Optional dual-book overlay — when present, FBR submission and
        /// tax-claim math read the AdjustedXxx values instead of the ones
        /// on this row. Bill print always uses this row directly.
        /// 2026-05-11: added.
        /// </summary>
        public InvoiceItemAdjustment? Adjustment { get; set; }
    }
}
