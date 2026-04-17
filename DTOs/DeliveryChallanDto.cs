namespace MyApp.Api.DTOs
{
    public class DeliveryChallanDto
    {
        public int Id { get; set; }
        public int ChallanNumber { get; set; }
        public int ClientId { get; set; }
        public string ClientName { get; set; } = "";
        public string PoNumber { get; set; } = "";
        public DateTime? PoDate { get; set; }
        public DateTime? DeliveryDate { get; set; }
        public string? Site { get; set; }
        public string Status { get; set; } = "Pending";
        public int? InvoiceId { get; set; }
        public string? InvoiceFbrStatus { get; set; }
        public bool IsEditable { get; set; }
        public List<DeliveryItemDto> Items { get; set; } = new();
        public List<string> Warnings { get; set; } = new();
    }
}
