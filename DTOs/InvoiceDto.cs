namespace MyApp.Api.DTOs
{
    public class InvoiceDto
    {
        public int Id { get; set; }
        public int InvoiceNumber { get; set; }
        public DateTime Date { get; set; }
        public int CompanyId { get; set; }
        public string CompanyName { get; set; } = "";
        public int ClientId { get; set; }
        public string ClientName { get; set; } = "";
        public decimal Subtotal { get; set; }
        public decimal GSTRate { get; set; }
        public decimal GSTAmount { get; set; }
        public decimal GrandTotal { get; set; }
        public string AmountInWords { get; set; } = "";
        public string? PaymentTerms { get; set; }
        public int? DocumentType { get; set; }
        public string? PaymentMode { get; set; }
        public string? FbrInvoiceNumber { get; set; }
        public string? FbrIRN { get; set; }
        public string? FbrStatus { get; set; }
        public DateTime? FbrSubmittedAt { get; set; }
        public string? FbrErrorMessage { get; set; }
        public DateTime CreatedAt { get; set; }
        public bool IsEditable { get; set; }
        public List<InvoiceItemDto> Items { get; set; } = new();
        public List<int> ChallanNumbers { get; set; } = new();
    }

    public class InvoiceItemDto
    {
        public int Id { get; set; }
        public int? DeliveryItemId { get; set; }
        public string ItemTypeName { get; set; } = "";
        public string Description { get; set; } = "";
        public int Quantity { get; set; }
        public string UOM { get; set; } = "";
        public decimal UnitPrice { get; set; }
        public decimal LineTotal { get; set; }
        public string? HSCode { get; set; }
        public int? FbrUOMId { get; set; }
        public string? SaleType { get; set; }
        public int? RateId { get; set; }
    }

    public class CreateInvoiceDto
    {
        public DateTime Date { get; set; }
        public int CompanyId { get; set; }
        public int ClientId { get; set; }
        public decimal GSTRate { get; set; }
        public string? PaymentTerms { get; set; }
        public int? DocumentType { get; set; }
        public string? PaymentMode { get; set; }
        public List<int> ChallanIds { get; set; } = new();
        public List<CreateInvoiceItemDto> Items { get; set; } = new();
        public Dictionary<int, DateTime> PoDateUpdates { get; set; } = new();
    }

    public class CreateInvoiceItemDto
    {
        public int DeliveryItemId { get; set; }
        public decimal UnitPrice { get; set; }
        public string? Description { get; set; }
        public string? HSCode { get; set; }
        public int? FbrUOMId { get; set; }
        public string? SaleType { get; set; }
        public int? RateId { get; set; }
    }

    /// <summary>
    /// DTO for editing an existing invoice (bill) before FBR submission.
    /// Users can update prices, descriptions, GST rate, FBR fields, and even
    /// quantity if an item's source challan item was also updated.
    /// </summary>
    public class UpdateInvoiceDto
    {
        public decimal GSTRate { get; set; }
        public string? PaymentTerms { get; set; }
        public int? DocumentType { get; set; }
        public string? PaymentMode { get; set; }
        public List<UpdateInvoiceItemDto> Items { get; set; } = new();
    }

    public class UpdateInvoiceItemDto
    {
        public int Id { get; set; }  // 0 for new items, >0 for existing
        public int? DeliveryItemId { get; set; }
        public string Description { get; set; } = "";
        public int Quantity { get; set; }
        public string UOM { get; set; } = "";
        public decimal UnitPrice { get; set; }
        public string? HSCode { get; set; }
        public int? FbrUOMId { get; set; }
        public string? SaleType { get; set; }
        public int? RateId { get; set; }
    }
}
