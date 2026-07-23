namespace MyApp.Api.DTOs
{
    /// <summary>Receipt (money in) / Payment (money out) voucher. Both are rows
    /// of the single Payment entity, printed with the Receipt or Payment
    /// template respectively; the shape is identical, <see cref="Direction"/>
    /// tells the template which it is. Division-free (master has no Division):
    /// only the company branding block is bound.</summary>
    public class PrintPaymentVoucherDto
    {
        public string CompanyBrandName { get; set; } = "";
        public string? CompanyLogoPath { get; set; }
        public string? CompanyAddress { get; set; }
        public string? CompanyPhone { get; set; }
        public string? CompanyNTN { get; set; }
        public string? CompanySTRN { get; set; }

        public string Direction { get; set; } = "";          // "Receipt" | "Payment"
        public string Reference { get; set; } = "";
        public DateTime Date { get; set; }
        public string ContactType { get; set; } = "";        // "Client" | "Supplier"
        public string ContactName { get; set; } = "";
        public string? ContactAddress { get; set; }
        public string? ContactPhone { get; set; }
        public string? Method { get; set; }
        public string? BankAccountName { get; set; }
        public string? ChequeNumber { get; set; }
        public DateTime? ChequeDate { get; set; }
        public string? Description { get; set; }
        public decimal Amount { get; set; }
        public string AmountInWords { get; set; } = "";
        public List<PrintPaymentAllocationDto> Allocations { get; set; } = new();
    }

    public class PrintPaymentAllocationDto
    {
        public int SNo { get; set; }
        public string DocumentLabel { get; set; } = "";      // "Invoice #123" / "Bill #45"
        public DateTime? Date { get; set; }
        public decimal Amount { get; set; }
    }
}
