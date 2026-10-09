namespace MyApp.Api.DTOs
{
    public class PurchaseDebitNoteDto
    {
        public int Id { get; set; }
        public int DebitNoteNumber { get; set; }
        public DateTime Date { get; set; }
        public int CompanyId { get; set; }


        public int SupplierId { get; set; }
        public string SupplierName { get; set; } = "";
        public string? SupplierRef { get; set; }
        public string? Notes { get; set; }
        public decimal Subtotal { get; set; }
        public decimal GSTRate { get; set; }
        public decimal GSTAmount { get; set; }
        public decimal GrandTotal { get; set; }
        public List<PurchaseDebitNoteItemDto> Items { get; set; } = new();
    }

    public class PurchaseDebitNoteItemDto
    {
        public int Id { get; set; }
        public string Description { get; set; } = "";
        public decimal Quantity { get; set; }
        public string? UOM { get; set; }
        public decimal UnitPrice { get; set; }
        public decimal LineTotal { get; set; }
        public int? ItemTypeId { get; set; }
        public string? ItemTypeName { get; set; }
        public int? AccountId { get; set; }
        public string? AccountName { get; set; }
        public string? HSCode { get; set; }
    }
    public class CreatePurchaseDebitNoteDto
    {
        public DateTime Date { get; set; }
        public int CompanyId { get; set; }

        public int SupplierId { get; set; }
        public string? SupplierRef { get; set; }
        public string? Notes { get; set; }
        public decimal GSTRate { get; set; }
        public List<CreatePurchaseDebitNoteItemDto> Items { get; set; } = new();
    }
    public class UpdatePurchaseDebitNoteDto
    {
        public DateTime? Date { get; set; }
        public int SupplierId { get; set; }
        public string? SupplierRef { get; set; }
        public string? Notes { get; set; }
        public decimal GSTRate { get; set; }
        public List<CreatePurchaseDebitNoteItemDto> Items { get; set; } = new();
    }
    public class CreatePurchaseDebitNoteItemDto
    {
        public string Description { get; set; } = "";
        public decimal Quantity { get; set; }
        public string? UOM { get; set; }
        public decimal UnitPrice { get; set; }
        public int? ItemTypeId { get; set; }
        public int? AccountId { get; set; }
        public string? HSCode { get; set; }
    }
}
