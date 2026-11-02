namespace MyApp.Api.DTOs
{
    public class PrintAccountingBrandingDto
    {
        public string CompanyBrandName { get; set; } = "";
        public string? CompanyLogoPath { get; set; }
        public string? CompanyAddress { get; set; }
        public string? CompanyPhone { get; set; }
        public string? CompanyNTN { get; set; }
        public string? CompanySTRN { get; set; }
    }
    /// <summary>Inter-account (bank/cash) transfer advice.</summary>
    public class PrintTransferDto : PrintAccountingBrandingDto
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
    public class PrintJournalEntryDto : PrintAccountingBrandingDto
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

}
