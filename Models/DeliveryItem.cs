namespace MyApp.Api.Models
{
    public class DeliveryItem
    {
        public int Id { get; set; }
        public int DeliveryChallanId { get; set; }
        public DeliveryChallan DeliveryChallan { get; set; }

        public int? ItemTypeId { get; set; }
        public string Description { get; set; } = "";
        public int Quantity { get; set; }
        public string Unit { get; set; } = "";

        // Navigation
        public ItemType? ItemType { get; set; }
    }
}
