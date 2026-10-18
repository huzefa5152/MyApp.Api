using System.ComponentModel.DataAnnotations;
namespace MyApp.Api.DTOs;

public class CreateStockEntryDto
{
    public int CompanyId { get; set; }
    public int ItemTypeId { get; set; }
    public Guid RequestId { get; set; }
    public string Kind { get; set; } = "Opening";
    public DateTime Date { get; set; }
    public decimal QuantityDelta { get; set; }
    public decimal UnitCost { get; set; }
    [Required, MaxLength(500)] public string Reason { get; set; } = "";
}
