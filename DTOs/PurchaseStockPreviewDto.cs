namespace MyApp.Api.DTOs;

public class PurchaseStockPreviewRequest
{
    public int CompanyId { get; set; }
    public int? BillId { get; set; }
    public List<CreatePurchaseItemDto> Items { get; set; } = new();
}

public record PurchaseStockImpactDto(int ItemTypeId, string Name, string? HSCode,
    string? UOM, bool TracksStock, decimal CurrentQuantity, decimal ChangeQuantity,
    decimal AfterQuantity);

public record PurchaseStockPreviewDto(bool TrackingEnabled, bool IsNonStock,
    List<PurchaseStockImpactDto> Items);
