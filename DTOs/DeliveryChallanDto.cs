namespace MyApp.Api.DTOs
{
    public class DeliveryChallanDto
    {
        public int ChallanNumber { get; set; }
        public int ClientId { get; set; }
        public string PoNumber { get; set; } = "";
        public DateTime? DeliveryDate { get; set; }
        public List<DeliveryItemDto> Items { get; set; } = new();
    }
}
