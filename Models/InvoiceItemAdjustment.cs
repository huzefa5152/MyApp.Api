namespace MyApp.Api.Models
{
    /// <summary>
    /// Dual-book overlay for a single <see cref="InvoiceItem"/>.
    ///
    /// The bill the operator prints (and the customer signs) is the
    /// InvoiceItem row — Quantity, UnitPrice, ItemTypeId, HSCode, etc.
    /// That's the source of truth: it reflects the real sale.
    ///
    /// When the operator runs the tax-claim optimization in Invoice
    /// mode (the FBR filing view), they may need a different
    /// decomposition of the SAME line subtotal — e.g. an item that
    /// physically shipped as "1 bundle, Rs. 33,800" but is most
    /// claim-efficient to file as "104 units, Rs. 325 each". Both
    /// recompose to Rs. 33,800; only the per-unit math differs.
    ///
    /// Those Invoice-mode tweaks land HERE, NOT on InvoiceItem:
    ///   • Bill print continues to use InvoiceItem → customer sees
    ///     the real qty/price.
    ///   • FBR submission + tax-claim summary read the overlay (when
    ///     present) and fall back to InvoiceItem otherwise → claim
    ///     math respects the operator's filing intent.
    ///
    /// Exactly zero-or-one InvoiceItemAdjustment per InvoiceItem.
    /// Deleting the InvoiceItem cascades the overlay. Deleting the
    /// overlay just reverts the FBR view to InvoiceItem (= no
    /// adjustment).
    ///
    /// 2026-05-11: added.
    /// </summary>
    public class InvoiceItemAdjustment
    {
        public int Id { get; set; }

        /// <summary>The InvoiceItem this overlay belongs to. Cascade on delete.</summary>
        public int InvoiceItemId { get; set; }

        /// <summary>Denormalized for query convenience (filter all overlays for an invoice in one shot).</summary>
        public int InvoiceId { get; set; }

        // ── Adjusted values used for FBR filing / tax-claim math ──
        // All optional — only the fields the operator actually
        // changed need to be populated. NULL means "use InvoiceItem's
        // value." That keeps the overlay minimal: a row that only
        // changes Quantity doesn't carry stale copies of every other
        // field.
        public decimal? AdjustedQuantity { get; set; }
        public decimal? AdjustedUnitPrice { get; set; }
        public decimal? AdjustedLineTotal { get; set; }
        public int? AdjustedItemTypeId { get; set; }
        public string? AdjustedItemTypeName { get; set; }
        public string? AdjustedDescription { get; set; }
        public string? AdjustedUOM { get; set; }
        public int? AdjustedFbrUOMId { get; set; }
        public string? AdjustedHSCode { get; set; }
        public string? AdjustedSaleType { get; set; }

        /// <summary>
        /// Why the overlay exists. Free-text classification — current
        /// values:
        ///   • "tax-claim-optimization" — operator applied the
        ///     /tax-claim suggestion in Invoice mode.
        ///   • "manual-fbr-tweak" — operator hand-edited in Invoice mode.
        /// </summary>
        public string Reason { get; set; } = "tax-claim-optimization";

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime? UpdatedAt { get; set; }
        public int? CreatedByUserId { get; set; }

        // Navigation
        public InvoiceItem InvoiceItem { get; set; } = null!;
    }
}
