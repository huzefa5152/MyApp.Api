namespace MyApp.Api.DTOs
{
    /// <summary>Wire shape for a purchase (supplier-side) debit note.</summary>
    public class PurchaseDebitNoteDto
    {
        public int Id { get; set; }
        public int DebitNoteNumber { get; set; }
        public DateTime Date { get; set; }
        public int CompanyId { get; set; }
        public int? DivisionId { get; set; }
        public string? DivisionName { get; set; }
        public int SupplierId { get; set; }
        public string SupplierName { get; set; } = "";
        public string? SupplierRef { get; set; }
        public string? Notes { get; set; }
        public decimal Subtotal { get; set; }
        public decimal GSTAmount { get; set; }
        public decimal GrandTotal { get; set; }
        public bool IsMigrated { get; set; }
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
    }
}
