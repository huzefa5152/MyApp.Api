namespace MyApp.Api.DTOs
{
    public class PrintWithholdingReceiptDto
    {
        public string CompanyBrandName { get; set; } = "";
        public string? CompanyLogoPath { get; set; }
        public string? CompanyAddress { get; set; }
        public string? CompanyPhone { get; set; }
        public string? CompanyNTN { get; set; }
        public string? CompanySTRN { get; set; }
        public int ReceiptNumber { get; set; }
        public DateTime Date { get; set; }
        public string CustomerName { get; set; } = "";
        public string? CustomerAddress { get; set; }
        public string? CustomerNTN { get; set; }
        public string? CustomerSTRN { get; set; }
        public string? Description { get; set; }
        public decimal Amount { get; set; }
        public string AmountInWords { get; set; } = "";
    }
}
