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
    /// <summary>Quantity on paid, credited or manually entered supplier bills; costs no longer move it.</summary>
    public decimal LockedQuantity { get; set; }
    public decimal SellingAmount { get; set; }
    public decimal? ActualUnitCost { get; set; }
    public int? SupplierId { get; set; }
    /// <summary>Remaining quantity at the estimated cost; recorded purchases never use it.</summary>
    public decimal? EstimatedAmount => ActualUnitCost.HasValue ? Math.Round(RemainingQuantity * ActualUnitCost.Value, 2) : null;
    /// <summary>What was paid to suppliers plus the estimate for what is still to buy.</summary>
    public decimal? ActualAmount => PurchasedQuantity > 0 || ActualUnitCost.HasValue
        ? Math.Round(PurchasedAmount + (EstimatedAmount ?? 0m), 2) : null;
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
