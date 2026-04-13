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
        public DateTime CreatedAt { get; set; }
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
    }

    public class CreateInvoiceDto
    {
        public DateTime Date { get; set; }
        public int CompanyId { get; set; }
        public int ClientId { get; set; }
        public decimal GSTRate { get; set; }
        public string? PaymentTerms { get; set; }
        public List<int> ChallanIds { get; set; } = new();
        public List<CreateInvoiceItemDto> Items { get; set; } = new();
        public Dictionary<int, DateTime> PoDateUpdates { get; set; } = new();
    }

    public class CreateInvoiceItemDto
    {
        public int DeliveryItemId { get; set; }
        public decimal UnitPrice { get; set; }
    }
}
