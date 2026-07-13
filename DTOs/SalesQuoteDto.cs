namespace MyApp.Api.DTOs
{
    /// <summary>
    /// Wire shape for a Sales Quote (priced pre-sale quotation). Used for both
    /// read and create/update — totals (Subtotal / GSTAmount / GrandTotal /
    /// AmountInWords) are always RE-COMPUTED server-side from the line items +
    /// GSTRate, so any values the client sends for them are ignored. This
    /// mirrors how InvoiceService treats invoice totals.
    /// </summary>
    public class SalesQuoteDto
    {
        public int Id { get; set; }
        public int QuoteNumber { get; set; }
        public int CompanyId { get; set; }
        public int ClientId { get; set; }
        public string ClientName { get; set; } = "";
        public int? DivisionId { get; set; }
        public string? DivisionName { get; set; }
        public DateTime Date { get; set; }
        public DateTime? ValidUntil { get; set; }
        public string? CustomerEnquiryRef { get; set; }
        public DateTime? EnquiryDate { get; set; }
        public string? Notes { get; set; }

        public decimal Subtotal { get; set; }
        public decimal GSTRate { get; set; }
        public decimal GSTAmount { get; set; }
        public decimal GrandTotal { get; set; }
        public string AmountInWords { get; set; } = "";

        public string Status { get; set; } = "Draft";
        public int? ConvertedToSalesOrderId { get; set; }
        public int? ConvertedToSalesOrderNumber { get; set; }

        /// <summary>Editable while not yet converted to a Sales Order.</summary>
        public bool IsEditable { get; set; }
        /// <summary>True when this is the highest-numbered quote for its company (gates Delete).</summary>
        public bool IsLatest { get; set; }
        public DateTime CreatedAt { get; set; }

        public List<SalesQuoteItemDto> Items { get; set; } = new();
    }

    public class SalesQuoteItemDto
    {
        public int Id { get; set; }
        public int? ItemTypeId { get; set; }
        public string ItemTypeName { get; set; } = "";
        /// <summary>Optional NonInventoryItem link (GL-account shortcut). Mutually exclusive with ItemTypeId.</summary>
        public int? NonInventoryItemId { get; set; }
        public string? NonInventoryItemName { get; set; }
        public string Description { get; set; } = "";
        // Decimal — same formatting contract as DeliveryItemDto.Quantity.
        public decimal Quantity { get; set; }
        public string Unit { get; set; } = "";
        public decimal UnitPrice { get; set; }
        public decimal LineTotal { get; set; }
    }

    /// <summary>
    /// Most-recent billed unit price for an item, surfaced to the Sales Quote
    /// form so picking an item that already exists in the system pre-fills its
    /// price (per the operator's "if the item already has a price" rule).
    /// </summary>
    public class QuoteItemRateDto
    {
        public decimal? LastUnitPrice { get; set; }
        public int? LastInvoiceNumber { get; set; }
        public DateTime? LastInvoiceDate { get; set; }
        public string? LastClientName { get; set; }
        /// <summary>"ItemType" (matched by catalog id) or "Description" (fallback). Null when no match.</summary>
        public string? MatchedBy { get; set; }
    }
}
