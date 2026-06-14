namespace MyApp.Api.DTOs
{
    /// <summary>
    /// Wire shape for a Sales Order — the quantity-only confirmed order. No
    /// pricing (that's entered at bill time). Per line, the server computes
    /// DeliveredQuantity (SUM of linked challan-line quantities) and
    /// RemainingQuantity, and rolls them up into <see cref="FulfillmentStatus"/>.
    /// </summary>
    public class SalesOrderDto
    {
        public int Id { get; set; }
        public int SalesOrderNumber { get; set; }
        public int CompanyId { get; set; }
        public int ClientId { get; set; }
        public string ClientName { get; set; } = "";
        public DateTime OrderDate { get; set; }
        public DateTime? RequiredDate { get; set; }
        public string? CustomerPoNumber { get; set; }
        public DateTime? CustomerPoDate { get; set; }
        public string? Site { get; set; }
        public string? Notes { get; set; }

        /// <summary>Operator lifecycle: Open / Closed / Cancelled.</summary>
        public string Status { get; set; } = "Open";

        /// <summary>
        /// Computed delivery roll-up across all lines:
        /// "Not Delivered" / "Partially Delivered" / "Fully Delivered" /
        /// "Over Delivered". Independent of the operator Status above.
        /// </summary>
        public string FulfillmentStatus { get; set; } = "Not Delivered";

        /// <summary>
        /// Billing roll-up across the order's (non-cancelled) challans:
        /// "Uninvoiced" / "Partially Invoiced" / "Invoiced". Independent of the
        /// delivery and operator statuses above.
        /// </summary>
        public string InvoiceStatus { get; set; } = "Uninvoiced";

        public int? SalesQuoteId { get; set; }
        public int? SalesQuoteNumber { get; set; }
        public bool IsImported { get; set; }

        /// <summary>Editable while Open and not yet (partially) delivered.</summary>
        public bool IsEditable { get; set; }
        /// <summary>True when this is the highest-numbered order for its company (gates Delete).</summary>
        public bool IsLatest { get; set; }
        /// <summary>How many delivery challans have been raised against this order.</summary>
        public int ChallanCount { get; set; }
        /// <summary>Attached challans that can be billed now (status Pending/Imported) — gates "Generate Bill".</summary>
        public int BillableChallanCount { get; set; }
        public DateTime CreatedAt { get; set; }

        public List<SalesOrderItemDto> Items { get; set; } = new();
    }

    public class SalesOrderItemDto
    {
        public int Id { get; set; }
        public int? ItemTypeId { get; set; }
        public string ItemTypeName { get; set; } = "";
        public string Description { get; set; } = "";
        /// <summary>Ordered quantity.</summary>
        public decimal Quantity { get; set; }
        public string Unit { get; set; } = "";

        // ── Computed fulfilment (server-side, never stored) ──
        public decimal DeliveredQuantity { get; set; }
        /// <summary>max(Quantity - Delivered, 0) — what's still outstanding.</summary>
        public decimal RemainingQuantity { get; set; }
        /// <summary>"Pending" / "Partial" / "Complete" / "Over".</summary>
        public string LineStatus { get; set; } = "Pending";
    }

    /// <summary>
    /// Request body for "Create Delivery Challan from this Sales Order". When
    /// <see cref="Lines"/> is empty the server delivers the REMAINING quantity
    /// of every line; otherwise it delivers exactly the quantities supplied
    /// (zero-quantity lines are skipped). Each delivered line is linked back to
    /// its <see cref="DeliverLineDto.SalesOrderItemId"/> for fulfilment tracking.
    /// </summary>
    public class CreateChallanFromOrderDto
    {
        public DateTime? DeliveryDate { get; set; }
        public string? Site { get; set; }
        public List<DeliverLineDto> Lines { get; set; } = new();
    }

    public class DeliverLineDto
    {
        public int SalesOrderItemId { get; set; }
        public decimal Quantity { get; set; }
    }

    /// <summary>Body for the status-change endpoints on quotes and orders.</summary>
    public class SetStatusDto
    {
        public string Status { get; set; } = "";
    }

    /// <summary>
    /// One delivery challan raised against a Sales Order, for the order's
    /// View / drill-down. Lightweight summary plus the lines it delivered, so
    /// the operator can see exactly how an order was fulfilled across challans.
    /// </summary>
    public class SalesOrderChallanDto
    {
        public int Id { get; set; }
        public int ChallanNumber { get; set; }
        public DateTime? DeliveryDate { get; set; }
        public string Status { get; set; } = "";
        public string? Site { get; set; }
        public bool IsImported { get; set; }
        /// <summary>The bill this challan is on, or null when not yet billed.</summary>
        public int? InvoiceId { get; set; }
        /// <summary>How many of this challan's lines fulfil this order.</summary>
        public int ItemCount { get; set; }
        /// <summary>Sum of delivered quantity on this challan for this order.</summary>
        public decimal TotalQuantity { get; set; }
        public List<SalesOrderChallanLineDto> Lines { get; set; } = new();
    }

    public class SalesOrderChallanLineDto
    {
        public string Description { get; set; } = "";
        public decimal Quantity { get; set; }
        public string Unit { get; set; } = "";
    }
}
