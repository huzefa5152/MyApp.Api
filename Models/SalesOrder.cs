namespace MyApp.Api.Models
{
    /// <summary>
    /// The internal, tracked representation of a customer's Purchase Order —
    /// the confirmed intent to buy. This is a QUANTITY-ONLY document: it
    /// records what the customer ordered (item + quantity + unit) but carries
    /// no pricing. Pricing is entered later at bill time (per the operator's
    /// decision — a Sales Order shouldn't worry about price).
    ///
    /// Flow: (Sales Quote →) Sales Order → one or more Delivery Challans →
    /// Bill. Each <see cref="DeliveryChallan"/> created against the order
    /// links back via DeliveryChallan.SalesOrderId, and each challan line
    /// links to a <see cref="SalesOrderItem"/> via DeliveryItem.SalesOrderItemId,
    /// so delivered-vs-ordered quantities roll up for fulfilment tracking
    /// (Open / Partially Delivered / Fully Delivered / Over Delivered).
    ///
    /// Sales Orders are NOT FBR documents.
    /// </summary>
    public class SalesOrder
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public int SalesOrderNumber { get; set; }
        public int ClientId { get; set; }

        public DateTime OrderDate { get; set; }
        /// <summary>Customer's requested delivery date, when known.</summary>
        public DateTime? RequiredDate { get; set; }

        /// <summary>
        /// The customer's own PO number (the order is a replica of that PO).
        /// Free text — preserved from a parsed PO or typed by the operator.
        /// </summary>
        public string? CustomerPoNumber { get; set; }
        public DateTime? CustomerPoDate { get; set; }

        public string? Site { get; set; }
        public string? Notes { get; set; }

        /// <summary>
        /// Fulfilment lifecycle, recomputed from the linked challans' delivered
        /// quantities: Open → Partially Delivered → Fully Delivered. "Over
        /// Delivered" flags when challans exceed the ordered quantity on any
        /// line. "Closed"/"Cancelled" are terminal operator-set states.
        /// </summary>
        public string Status { get; set; } = "Open";

        /// <summary>Set when this order was created by converting a Sales Quote.</summary>
        public int? SalesQuoteId { get; set; }

        /// <summary>
        /// True when the order was created from an imported customer PO (the
        /// PO-parser flow) rather than typed by hand. Informational only.
        /// </summary>
        public bool IsImported { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Navigation
        public Company Company { get; set; } = null!;
        public Client Client { get; set; } = null!;
        public SalesQuote? SalesQuote { get; set; }
        public ICollection<SalesOrderItem> Items { get; set; } = new List<SalesOrderItem>();
        public ICollection<DeliveryChallan> DeliveryChallans { get; set; } = new List<DeliveryChallan>();
    }
}
