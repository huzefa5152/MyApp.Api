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
        public DateTime? PoDate { get; set; }
        public DateTime? DeliveryDate { get; set; }
        public string? Site { get; set; }
        public string Status { get; set; } = "Pending";
        public int? InvoiceId { get; set; }

        // Flag for challans created via the historical Excel import flow.
        // Informational only — MUST NOT gate billing or any core flow; imported
        // challans participate in Bill/Invoice creation just like native ones.
        public bool IsImported { get; set; }

        // Navigation
        public Company Company { get; set; } = null!;
        public Client Client { get; set; } = null!;
        public Invoice? Invoice { get; set; }
        public ICollection<DeliveryItem> Items { get; set; } = new List<DeliveryItem>();
    }
}
