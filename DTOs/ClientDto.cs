namespace MyApp.Api.DTOs
{
    public class ClientDto
    {
        public int? Id { get; set; }           // Nullable for new clients
        public string Name { get; set; } = null!;
        public string? Address { get; set; }
        public string? Phone { get; set; }
        public string? Email { get; set; }
        public string? NTN { get; set; }
        public string? STRN { get; set; }
        public string? Site { get; set; }
        public int CompanyId { get; set; }
        public bool HasInvoices { get; set; }
        public DateTime? CreatedAt { get; set; } // Nullable; set by server
    }
}
