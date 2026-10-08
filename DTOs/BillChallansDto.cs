using System.ComponentModel.DataAnnotations;

namespace MyApp.Api.DTOs;

public class BillChallanOptionDto
{
    public int Id { get; set; }
    public int ChallanNumber { get; set; }
    public string PoNumber { get; set; } = "";
    public DateTime? DeliveryDate { get; set; }
    public int? SalesOrderId { get; set; }
    public int? SalesOrderNumber { get; set; }
    public string Version { get; set; } = "";
    public List<BillChallanItemDto> Items { get; set; } = new();
}

public class BillChallanItemDto
{
    public int Id { get; set; }
    public string Description { get; set; } = "";
    public decimal Quantity { get; set; }
    public string Unit { get; set; } = "";
}

public class BillChallanOptionsDto
{
    public InvoiceDto Bill { get; set; } = null!;
    public string Version { get; set; } = "";
    public List<BillChallanOptionDto> Linked { get; set; } = new();
    public List<BillChallanOptionDto> Available { get; set; } = new();
    public bool HasMore { get; set; }
}

public class UpdateBillChallansDto
{
    public bool AttachAddedChallansToOrder { get; set; }
    [Required] public string Version { get; set; } = "";
    [Required, MaxLength(100)] public List<int> ChallanIds { get; set; } = new();
    [Required] public Dictionary<int, string> AddedChallanVersions { get; set; } = new();
    [Required] public Dictionary<int, decimal> UnitPrices { get; set; } = new();
}
