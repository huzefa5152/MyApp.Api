namespace MyApp.Api.DTOs;

public class ChallanPrivateCostsDto
{
    public string Version { get; set; } = "";
    public List<ChallanPrivateCostLineDto> Items { get; set; } = new();
}

public class ChallanPrivateCostLineDto
{
    public int Id { get; set; }
    public int? SupplierId { get; set; }
    public decimal? ActualUnitCost { get; set; }
}
