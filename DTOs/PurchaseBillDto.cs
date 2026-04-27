namespace MyApp.Api.DTOs
{
    public class PurchaseBillDto
    {
        public int Id { get; set; }
        public int PurchaseBillNumber { get; set; }
        public DateTime Date { get; set; }
        public int CompanyId { get; set; }
        public string CompanyName { get; set; } = "";
        public int SupplierId { get; set; }
        public string SupplierName { get; set; } = "";
        public string? SupplierBillNumber { get; set; }
        public string? SupplierIRN { get; set; }
        public decimal Subtotal { get; set; }
        public decimal GSTRate { get; set; }
        public decimal GSTAmount { get; set; }
        public decimal GrandTotal { get; set; }
        public string AmountInWords { get; set; } = "";
        public string? PaymentTerms { get; set; }
        public int? DocumentType { get; set; }
        public string? PaymentMode { get; set; }
        public string ReconciliationStatus { get; set; } = "Pending";
        public DateTime CreatedAt { get; set; }
        public List<PurchaseItemDto> Items { get; set; } = new();
    }

    public class PurchaseItemDto
    {
        public int Id { get; set; }
        public int? ItemTypeId { get; set; }
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
        public decimal? FixedNotifiedValueOrRetailPrice { get; set; }
    }

    /// <summary>
    /// Payload for POST /api/purchasebills.
    /// </summary>
    public class CreatePurchaseBillDto
    {
        public DateTime Date { get; set; }
        public int CompanyId { get; set; }
        public int SupplierId { get; set; }
        public string? SupplierBillNumber { get; set; }
        public string? SupplierIRN { get; set; }
        public decimal GSTRate { get; set; }
        public string? PaymentTerms { get; set; }
        public int? DocumentType { get; set; }
        public string? PaymentMode { get; set; }
        public List<CreatePurchaseItemDto> Items { get; set; } = new();
    }

    public class CreatePurchaseItemDto
    {
        public int? ItemTypeId { get; set; }
        public string Description { get; set; } = "";
        public int Quantity { get; set; }
        public string? UOM { get; set; }
        public decimal UnitPrice { get; set; }
        public string? HSCode { get; set; }
        public int? FbrUOMId { get; set; }
        public string? SaleType { get; set; }
        public int? RateId { get; set; }
        public decimal? FixedNotifiedValueOrRetailPrice { get; set; }
    }

    /// <summary>
    /// Payload for PUT /api/purchasebills/{id}.
    /// </summary>
    public class UpdatePurchaseBillDto
    {
        public DateTime? Date { get; set; }
        public string? SupplierBillNumber { get; set; }
        public string? SupplierIRN { get; set; }
        public decimal GSTRate { get; set; }
        public string? PaymentTerms { get; set; }
        public int? DocumentType { get; set; }
        public string? PaymentMode { get; set; }
        public List<UpdatePurchaseItemDto> Items { get; set; } = new();
    }

    public class UpdatePurchaseItemDto
    {
        public int Id { get; set; }
        public int? ItemTypeId { get; set; }
        public string Description { get; set; } = "";
        public int Quantity { get; set; }
        public string UOM { get; set; } = "";
        public decimal UnitPrice { get; set; }
        public string? HSCode { get; set; }
        public int? FbrUOMId { get; set; }
        public string? SaleType { get; set; }
        public int? RateId { get; set; }
        public decimal? FixedNotifiedValueOrRetailPrice { get; set; }
    }
}
