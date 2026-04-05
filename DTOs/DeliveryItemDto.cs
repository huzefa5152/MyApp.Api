namespace MyApp.Api.DTOs
{
    public class DeliveryItemDto
    {
        public int Id { get; set; }
        public int? ItemTypeId { get; set; }
        public string ItemTypeName { get; set; } = "";
        public string Description { get; set; } = "";
        public int Quantity { get; set; }
        public string Unit { get; set; } = "";
    }
}
