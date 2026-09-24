namespace MyApp.Api.Models
{
    public class DeliveryItem
    {
        public int Id { get; set; }
        public int DeliveryChallanId { get; set; }
        public DeliveryChallan DeliveryChallan { get; set; }

        public int? ItemTypeId { get; set; }

        /// <summary>Optional link to a per-company NonInventoryItem (GL-account
        /// shortcut line, e.g. Freight). Mutually exclusive with ItemTypeId.</summary>
        public int? NonInventoryItemId { get; set; }

        // Optional link to the Sales Order line this challan line fulfils.
        // Set only when the challan was created from a Sales Order; null for
        // every other challan (additive — existing rows stay null). The
        // ordered line's delivered quantity is SUM(Quantity) over all
        // DeliveryItems pointing at it.
        public int? SalesOrderItemId { get; set; }

        public string Description { get; set; } = "";
        /// <summary>
        /// Stored as decimal(18,4) so fractional UOMs (KG, Liter, Carat, etc.)
        /// can carry up to 4 decimal places. Integer-only UOMs (Pcs, SET,
        /// Pair, etc.) are still constrained at the form layer and validated
        /// server-side via the unit's AllowsDecimalQuantity flag.
        /// </summary>
        public decimal Quantity { get; set; }

        /// <summary>
        /// What was PHYSICALLY delivered, kept when the bill writes a smaller
        /// billed quantity back over <see cref="Quantity"/>.
        ///
        /// Null on every line whose quantity has never been overwritten, which
        /// is the normal case — the delivered amount is then Quantity itself.
        /// It is set once, on the first write-back, and cleared when the challan
        /// is released; without it the original was unrecoverable, so deleting a
        /// bill returned the challan to the billable pool carrying the REDUCED
        /// quantity and the rest of the delivery could never be billed.
        /// </summary>
        public decimal? DeliveredQuantity { get; set; }

        public string Unit { get; set; } = "";

        // Internal procurement details. Never map these to a print DTO.
        public decimal? ActualUnitCost { get; set; }
        public int? SupplierId { get; set; }
        public Supplier? Supplier { get; set; }

        // Navigation
        public ItemType? ItemType { get; set; }
        public NonInventoryItem? NonInventoryItem { get; set; }
        public SalesOrderItem? SalesOrderItem { get; set; }
    }
}
