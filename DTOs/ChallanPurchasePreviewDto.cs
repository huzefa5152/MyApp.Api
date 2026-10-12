namespace MyApp.Api.DTOs;

public class ChallanPurchasePreviewDto
{
    public int ChallanId { get; set; }
    public int ChallanNumber { get; set; }
    public string Revision { get; set; } = "";
    public DateTime Date { get; set; }
    public bool TracksStock { get; set; }
    public bool AlreadyCreated { get; set; }
    public List<ChallanSupplierPurchaseDto> Suppliers { get; set; } = new();
}
public class ChallanSupplierPurchaseDto
{
    public int SupplierId { get; set; }
    public string SupplierName { get; set; } = "";
    public decimal GSTRate { get; set; }
    public string? SupplierBillNumber { get; set; }
    public List<PurchaseItemDto> Items { get; set; } = new();
}
public class CreateChallanPurchasesDto
{
    public string Revision { get; set; } = "";
    public DateTime Date { get; set; }
    public List<ChallanSupplierPurchaseDto> Suppliers { get; set; } = new();
}
