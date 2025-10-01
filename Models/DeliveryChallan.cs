namespace MyApp.Api.Models
{
    public class DeliveryChallan
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public int ChallanNumber { get; set; }

        // Replace old ClientName with ClientId foreign key
        public int ClientId { get; set; }
        public string PoNumber { get; set; } = "";
        public DateTime? DeliveryDate { get; set; }

        // Navigation
        public Company Company { get; set; } = null!;
        public Client Client { get; set; } = null!;
        public ICollection<DeliveryItem> Items { get; set; } = new List<DeliveryItem>();
    }
}
