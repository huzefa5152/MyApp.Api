namespace MyApp.Api.Models
{
    public class Company
    {
        public int Id { get; set; }
        public string Name { get; set; } = "";
        public int StartingChallanNumber { get; set; }
        public int CurrentChallanNumber { get; set; }

        public List<DeliveryChallan> DeliveryChallans { get; set; } = new();
        public List<Client> Clients { get; set; } = new();
    }
}
