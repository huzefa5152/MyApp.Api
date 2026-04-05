namespace MyApp.Api.Models
{
    public class Company
    {
        public int Id { get; set; }
        public string Name { get; set; } = "";
        public string? BrandName { get; set; }
        public string? LogoPath { get; set; }
        public string? FullAddress { get; set; }
        public string? Phone { get; set; }
        public string? NTN { get; set; }
        public string? STRN { get; set; }
        public int StartingChallanNumber { get; set; }
        public int CurrentChallanNumber { get; set; }
        public int StartingInvoiceNumber { get; set; }
        public int CurrentInvoiceNumber { get; set; }

        public List<DeliveryChallan> DeliveryChallans { get; set; } = new();
        public List<Client> Clients { get; set; } = new();
        public List<Invoice> Invoices { get; set; } = new();
    }
}
