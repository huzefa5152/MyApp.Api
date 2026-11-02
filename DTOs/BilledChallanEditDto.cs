namespace MyApp.Api.DTOs;

public class BilledChallanEditDto
{
    public string Version { get; set; } = "";
    public string BillVersion { get; set; } = "";
    public List<DeliveryItemDto> Items { get; set; } = new();
}

public class BilledChallanEditContextDto
{
    public DeliveryChallanDto Challan { get; set; } = null!;
    public InvoiceDto Bill { get; set; } = null!;
    public string BillVersion { get; set; } = "";
}
