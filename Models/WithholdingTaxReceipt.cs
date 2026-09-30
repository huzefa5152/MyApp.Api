namespace MyApp.Api.Models
{
    // Customer-issued withholding certificate, recorded separately from cash.
    // Invoice withholding already posts to the GL; this record does not post again.
    public class WithholdingTaxReceipt
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public int ReceiptNumber { get; set; }
        public int ClientId { get; set; }
        public DateTime Date { get; set; }
        public decimal Amount { get; set; }
        public string? Description { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public Company Company { get; set; } = null!;
        public Client Client { get; set; } = null!;
    }
}
