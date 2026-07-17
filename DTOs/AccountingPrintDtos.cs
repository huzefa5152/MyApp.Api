namespace MyApp.Api.DTOs
{
    /// <summary>
    /// Shared company + division branding block for the accounting print
    /// documents (receipt / payment / transfer / journal / withholding-tax).
    /// Mirrors the fields every existing Print*Dto carries so the templates
    /// bind the same {{companyBrandName}} / {{divisionName}} tokens. Inherited
    /// public properties serialize into the merge model just like declared ones.
    /// </summary>
    public abstract class PrintBrandingDto
    {
        public string CompanyBrandName { get; set; } = "";
        public string? CompanyLogoPath { get; set; }
        public string? CompanyAddress { get; set; }
        public string? CompanyPhone { get; set; }
        public string? DivisionName { get; set; }
        public string? DivisionBrandName { get; set; }
        public string? DivisionLogoPath { get; set; }
        public string? DivisionAddress { get; set; }
        public string? DivisionPhone { get; set; }
        public string? DivisionNTN { get; set; }
        public string? DivisionSTRN { get; set; }
        public string? DivisionEmail { get; set; }
    }

    /// <summary>Receipt (money in) / Payment (money out) voucher. Both are rows
    /// of the single Payment entity, printed with the Receipt or Payment
    /// template respectively; the shape is identical, <see cref="Direction"/>
    /// tells the template which it is.</summary>
    public class PrintPaymentVoucherDto : PrintBrandingDto
    {
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

    /// <summary>Inter-account (bank/cash) transfer advice.</summary>
    public class PrintTransferDto : PrintBrandingDto
    {
        public string Reference { get; set; } = "";
        public DateTime Date { get; set; }
        public string FromAccountName { get; set; } = "";
        public string ToAccountName { get; set; } = "";
        public string? Description { get; set; }
        public decimal Amount { get; set; }
        public string AmountInWords { get; set; } = "";
    }

    /// <summary>Manual / system journal voucher.</summary>
    public class PrintJournalEntryDto : PrintBrandingDto
    {
        public string Reference { get; set; } = "";          // "JE-####"
        public int EntryNo { get; set; }
        public DateTime Date { get; set; }
        public string? Narration { get; set; }
        public decimal TotalDebit { get; set; }
        public decimal TotalCredit { get; set; }
        public List<PrintJournalLineDto> Lines { get; set; } = new();
    }

    public class PrintJournalLineDto
    {
        public int SNo { get; set; }
        public string? AccountCode { get; set; }
        public string AccountName { get; set; } = "";
        public string? Description { get; set; }
        public decimal Debit { get; set; }
        public decimal Credit { get; set; }
    }

    /// <summary>Customer-issued withholding-tax certificate.</summary>
    public class PrintWithholdingReceiptDto : PrintBrandingDto
    {
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
