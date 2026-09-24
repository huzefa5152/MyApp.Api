namespace MyApp.Api.DTOs
{
    public class InvoiceSalesDetailRowDto
    {
        public int InvoiceId { get; set; }
        public int LineNumber { get; set; }
        public DateTime Date { get; set; }
        public string InvoiceSeries { get; set; } = "";
        public string InvoiceNumber { get; set; } = "";
        public string DeliveryChallanNumbers { get; set; } = "";
        public string Buyer { get; set; } = "";
        public string BuyerAddress { get; set; } = "";
        public string BuyerNtn { get; set; } = "";
        public string HsCode { get; set; } = "";
        public string Description { get; set; } = "";
        public string Unit { get; set; } = "";
        public decimal Quantity { get; set; }
        public decimal Rate { get; set; }
        public decimal ExcludingTax { get; set; }
        public decimal TaxRate { get; set; }
        public decimal SalesTax { get; set; }
        public decimal IncludingTax { get; set; }
        public decimal AdvanceTax { get; set; }
        public decimal FurtherTax { get; set; }
        public decimal Total { get; set; }
        public string FbrStatus { get; set; } = "";
        public string FbrInvoiceNumber { get; set; } = "";
        public string BillStatus { get; set; } = "";
    }

    public class InvoiceSalesDetailReportDto
    {
        public int CompanyId { get; set; }
        public string CompanyName { get; set; } = "";
        public string PeriodLabel { get; set; } = "";
        /// <summary>The first and last day the report covers, both included.</summary>
        public DateTime From { get; set; }
        public DateTime To { get; set; }
        public DateTime GeneratedAt { get; set; }
        public List<InvoiceSalesDetailRowDto> Rows { get; set; } = new();
        public int InvoiceCount { get; set; }
        public int SubmittedCount { get; set; }
        public int NotSubmittedCount { get; set; }
        public int CancelledCount { get; set; }
        public decimal ExcludingTax { get; set; }
        public decimal SalesTax { get; set; }
        public decimal AdvanceTax { get; set; }
        public decimal FurtherTax { get; set; }
        public decimal Total { get; set; }
        /// <summary>
        /// Every buyer with a bill in the PERIOD, before the customer, FBR status
        /// and search filters, so the customer picker never shrinks to the one
        /// customer chosen. Name and NTN only: the rows already show both.
        /// </summary>
        public List<InvoiceSalesDetailBuyerDto> Buyers { get; set; } = new();
    }

    public class InvoiceSalesDetailBuyerDto
    {
        public int ClientId { get; set; }
        public string Name { get; set; } = "";
        public string Ntn { get; set; } = "";
    }

    /// <summary>
    /// What the Invoice Sales Detail report is asked for. One shape for the
    /// screen and the Excel export, so the two always select the same bills.
    /// </summary>
    public class InvoiceSalesDetailQueryDto
    {
        /// <summary>A <see cref="Helpers.ReportPeriod"/> preset name. Absent: the
        /// legacy <see cref="Year"/> + <see cref="Month"/> when given, else this month.</summary>
        public string? Period { get; set; }
        public DateTime? From { get; set; }
        public DateTime? To { get; set; }
        /// <summary>Legacy month selection, honoured only when Period is absent.</summary>
        public int? Year { get; set; }
        public int? Month { get; set; }
        public string? Search { get; set; }
        /// <summary>"submitted" or "notSubmitted"; empty or "all" = no filter.</summary>
        public string? FbrStatus { get; set; }
        public int? ClientId { get; set; }
    }
}
