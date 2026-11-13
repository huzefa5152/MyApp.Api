namespace MyApp.Api.DTOs
{
    /// <summary>
    /// Reports > Ready for FBR: every bill the consultant has classified that is not yet sent,
    /// with the ORIGINAL bill lines beside the rows that will be FILED. A filing row may combine
    /// several bill lines and carry its own HS code, item, quantity and FBR unit.
    /// </summary>
    public class ReadyForFbrReportDto
    {
        public int CompanyId { get; set; }
        public string CompanyName { get; set; } = "";
        public string PeriodLabel { get; set; } = "";
        public DateTime From { get; set; }
        public DateTime To { get; set; }
        public DateTime GeneratedAt { get; set; }
        public List<ReadyForFbrBillDto> Bills { get; set; } = new();
        public int BillCount { get; set; }
        public int OriginalLineCount { get; set; }
        public int FilingRowCount { get; set; }
        public decimal ExcludingTax { get; set; }
        public decimal SalesTax { get; set; }
        public decimal FurtherTax { get; set; }
        public decimal Total { get; set; }
        /// <summary>Every buyer with a ready bill in the period, for the client picker.</summary>
        public List<InvoiceSalesDetailBuyerDto> Buyers { get; set; } = new();
    }

    public class ReadyForFbrBillDto
    {
        public int InvoiceId { get; set; }
        public string InvoiceNumber { get; set; } = "";
        public DateTime Date { get; set; }
        public string Buyer { get; set; } = "";
        public string BuyerNtn { get; set; } = "";
        /// <summary>"Ready to validate", "Validated" or "Failed" (with FBR's message).</summary>
        public string FbrStatus { get; set; } = "";
        public string FbrMessage { get; set; } = "";
        public decimal TaxRate { get; set; }
        public decimal ExcludingTax { get; set; }
        public decimal SalesTax { get; set; }
        public decimal FurtherTax { get; set; }
        public decimal Total { get; set; }
        public List<ReadyForFbrOriginalLineDto> OriginalLines { get; set; } = new();
        public List<ReadyForFbrFilingRowDto> FilingRows { get; set; } = new();
    }

    /// <summary>A line as the customer was billed.</summary>
    public class ReadyForFbrOriginalLineDto
    {
        public int LineNumber { get; set; }
        public string Description { get; set; } = "";
        public decimal Quantity { get; set; }
        public string Unit { get; set; } = "";
        public decimal Rate { get; set; }
        public decimal ExcludingTax { get; set; }
        /// <summary>The filing row this line is filed under.</summary>
        public int FilingRow { get; set; }
    }

    /// <summary>A row as it will be sent to FBR.</summary>
    public class ReadyForFbrFilingRowDto
    {
        public int RowNumber { get; set; }
        public string HsCode { get; set; } = "";
        /// <summary>The catalog item the consultant chose.</summary>
        public string Item { get; set; } = "";
        public decimal Quantity { get; set; }
        /// <summary>The FBR unit filed, which may differ from the bill's unit.</summary>
        public string Unit { get; set; } = "";
        public string SaleType { get; set; } = "";
        public decimal ExcludingTax { get; set; }
        public decimal SalesTax { get; set; }
        /// <summary>The bill lines this row files.</summary>
        public List<int> SourceLines { get; set; } = new();
    }
}
