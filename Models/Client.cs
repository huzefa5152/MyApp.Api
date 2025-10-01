namespace MyApp.Api.Models
{
    public class Client
    {
        public int Id { get; set; }
        public string Name { get; set; } = null!;
        public string? Address { get; set; }
        public string? Phone { get; set; }
        public string? Email { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Navigation
        public ICollection<DeliveryChallan> DeliveryChallans { get; set; } = new List<DeliveryChallan>();
    }
}
