namespace MyApp.Api.Models
{
    public class PrintTemplate
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public string TemplateType { get; set; } = ""; // Challan, Bill, TaxInvoice
        public string HtmlContent { get; set; } = "";
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

        public Company Company { get; set; } = null!;
    }
}
