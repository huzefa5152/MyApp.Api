namespace MyApp.Api.DTOs
{
    public class GoodsReceiptDto
    {
        public int Id { get; set; }
        public int GoodsReceiptNumber { get; set; }
        public DateTime ReceiptDate { get; set; }
        public int CompanyId { get; set; }
        public int SupplierId { get; set; }
        public string SupplierName { get; set; } = "";
        public int? PurchaseBillId { get; set; }
        public int? PurchaseBillNumber { get; set; }
        public string? SupplierChallanNumber { get; set; }
        public string? Site { get; set; }
        public string Status { get; set; } = "Pending";
        public DateTime CreatedAt { get; set; }
        public List<GoodsReceiptItemDto> Items { get; set; } = new();
    }

    public class GoodsReceiptItemDto
    {
        public int Id { get; set; }
        public int? ItemTypeId { get; set; }
        public string ItemTypeName { get; set; } = "";
        public string Description { get; set; } = "";
        public int Quantity { get; set; }
        public string Unit { get; set; } = "";
    }

    public class CreateGoodsReceiptDto
    {
        public DateTime ReceiptDate { get; set; }
        public int CompanyId { get; set; }
        public int SupplierId { get; set; }
        public int? PurchaseBillId { get; set; }
        public string? SupplierChallanNumber { get; set; }
        public string? Site { get; set; }
        public List<CreateGoodsReceiptItemDto> Items { get; set; } = new();
    }

    public class CreateGoodsReceiptItemDto
    {
        public int? ItemTypeId { get; set; }
        public string Description { get; set; } = "";
        public int Quantity { get; set; }
        public string Unit { get; set; } = "";
    }

    public class UpdateGoodsReceiptDto
    {
        public DateTime ReceiptDate { get; set; }
        public int SupplierId { get; set; }
        public int? PurchaseBillId { get; set; }
        public string? SupplierChallanNumber { get; set; }
        public string? Site { get; set; }
        public string? Status { get; set; }
        public List<UpdateGoodsReceiptItemDto> Items { get; set; } = new();
    }

    public class UpdateGoodsReceiptItemDto
    {
        public int Id { get; set; }
        public int? ItemTypeId { get; set; }
        public string Description { get; set; } = "";
        public int Quantity { get; set; }
        public string Unit { get; set; } = "";
    }
}
