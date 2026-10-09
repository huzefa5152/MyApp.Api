using MyApp.Api.Models.Accounting;

namespace MyApp.Api.Models
{
    public class PurchaseDebitNote
    {
        public int Id { get; set; }
        public int DebitNoteNumber { get; set; }
        public DateTime Date { get; set; }
        public int CompanyId { get; set; }

        public int SupplierId { get; set; }
        public string? SupplierRef { get; set; }
        public string? Notes { get; set; }

        public decimal Subtotal { get; set; }
        public decimal GSTRate { get; set; }
        public decimal GSTAmount { get; set; }
        public decimal GrandTotal { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public Company Company { get; set; } = null!;

        public Supplier Supplier { get; set; } = null!;
        public ICollection<PurchaseDebitNoteItem> Items { get; set; } = new List<PurchaseDebitNoteItem>();
    }
    public class PurchaseDebitNoteItem
    {
        public int Id { get; set; }
        public int PurchaseDebitNoteId { get; set; }
        public string Description { get; set; } = "";
        public decimal Quantity { get; set; }
        public string? UOM { get; set; }
        public decimal UnitPrice { get; set; }
        public decimal LineTotal { get; set; }
        public int? ItemTypeId { get; set; }
        public string? ItemTypeName { get; set; }
        public int? AccountId { get; set; }
        public string? HSCode { get; set; }
        public PurchaseDebitNote PurchaseDebitNote { get; set; } = null!;
        public ItemType? ItemType { get; set; }
        public Account? Account { get; set; }
    }
}
