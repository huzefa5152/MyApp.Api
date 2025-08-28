namespace MyApp.Api.Models
{
    public class DeliveryChallan
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public Company Company { get; set; }

        public int ChallanNumber { get; set; }
        public string ClientName { get; set; } = "";
        public string PoNumber { get; set; } = "";
        public DateTime? DeliveryDate { get; set; }

        public List<DeliveryItem> Items { get; set; } = new();
    }
}
