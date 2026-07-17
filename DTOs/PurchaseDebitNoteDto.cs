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
        public decimal GSTRate { get; set; }
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
        public int? ItemTypeId { get; set; }
        public string? ItemTypeName { get; set; }
        public int? AccountId { get; set; }
        public string? AccountName { get; set; }
        public string? HSCode { get; set; }
    }

    /// <summary>Create payload for a user-authored purchase debit note.</summary>
    public class CreatePurchaseDebitNoteDto
    {
        public DateTime Date { get; set; }
        public int CompanyId { get; set; }
        public int? DivisionId { get; set; }
        public int SupplierId { get; set; }
        public string? SupplierRef { get; set; }
        public string? Notes { get; set; }
        public decimal GSTRate { get; set; }
        public List<CreatePurchaseDebitNoteItemDto> Items { get; set; } = new();
    }

    /// <summary>Update payload — CompanyId/DivisionId are immutable (the number +
    /// division sequence never change), so they aren't accepted here.</summary>
    public class UpdatePurchaseDebitNoteDto
    {
        public DateTime? Date { get; set; }
        public int SupplierId { get; set; }
        public string? SupplierRef { get; set; }
        public string? Notes { get; set; }
        public decimal GSTRate { get; set; }
        public List<CreatePurchaseDebitNoteItemDto> Items { get; set; } = new();
    }

    /// <summary>One create/update line. ItemTypeId (inventory) and AccountId
    /// (direct GL) are both optional — a value-only line (both null) is allowed
    /// and posts to the default purchase account with no stock movement.</summary>
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
