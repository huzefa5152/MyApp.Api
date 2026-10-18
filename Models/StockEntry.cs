namespace MyApp.Api.Models;

public class StockEntry
{
    public int Id { get; set; }
    public int CompanyId { get; set; }
    public int ItemTypeId { get; set; }
    public Guid RequestId { get; set; }
    public string Kind { get; set; } = "Opening";
    public DateTime Date { get; set; }
    public decimal QuantityDelta { get; set; }
    public decimal UnitCost { get; set; }
    public string Reason { get; set; } = "";
    public bool IsCancelled { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public ItemType ItemType { get; set; } = null!;
}
