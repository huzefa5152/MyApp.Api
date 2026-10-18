namespace MyApp.Api.DTOs;

public class CommercialCostLineDto
{
    public int Id { get; set; }
    public int? DeliveryItemId { get; set; }
    public int? SourceChallanId { get; set; }
    public int? SourceChallanNumber { get; set; }
    public string Description { get; set; } = "";
    public string Unit { get; set; } = "";
    public decimal Quantity { get; set; }
    public decimal PurchasedQuantity { get; set; }
    public decimal RemainingQuantity => Math.Max(0m, Quantity - PurchasedQuantity);
    public decimal PurchasedAmount { get; set; }
    public bool CostOverride { get; set; }
    public decimal SellingAmount { get; set; }
    public decimal? ActualUnitCost { get; set; }
    public int? SupplierId { get; set; }
    public decimal? ActualAmount => CostOverride && ActualUnitCost.HasValue
        ? Math.Round(Quantity * ActualUnitCost.Value, 2)
        : (PurchasedQuantity > 0 || ActualUnitCost.HasValue)
            ? Math.Round(PurchasedAmount + (ActualUnitCost.HasValue ? RemainingQuantity * ActualUnitCost.Value : 0m), 2) : null;
    public decimal? Profit => ActualAmount.HasValue ? SellingAmount - ActualAmount.Value : null;
    public bool PurchaseRecorded { get; set; }
}

public class CommercialCostDto
{
    public int Id { get; set; }
    public int Number { get; set; }
    public int CompanyId { get; set; }
    public string Version { get; set; } = "";
    public List<CommercialCostLineDto> Items { get; set; } = new();
    public decimal SellingAmount => Items.Sum(i => i.SellingAmount);
    public decimal ActualAmount => Items.Sum(i => i.ActualAmount ?? 0);
    public bool CostComplete => Items.Count > 0 && Items.All(i => i.RemainingQuantity <= 0 || i.ActualUnitCost.HasValue);
    public decimal Profit => SellingAmount - ActualAmount;
    public decimal? MarginPercent => SellingAmount == 0 ? null : Math.Round(Profit / SellingAmount * 100, 2);
}

public class SaveCommercialCostsDto
{
    public string Version { get; set; } = "";
    public List<ChallanPrivateCostLineDto> Items { get; set; } = new();
}

public class CreateLocalPurchasesDto
{
    public string Version { get; set; } = "";
    public DateTime Date { get; set; }
    public List<int> ItemIds { get; set; } = new();
    public List<LocalPurchaseSettingsDto> Suppliers { get; set; } = new();
}

public class LocalPurchaseSettingsDto
{
    public int SupplierId { get; set; }
    public int? ChallanId { get; set; }
    public string? SupplierBillNumber { get; set; }
    public decimal GSTRate { get; set; }
}
