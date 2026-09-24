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
        public List<InvoiceSalesDetailRowDto> Rows { get; set; } = new();
        public int InvoiceCount { get; set; }
        public int SubmittedCount { get; set; }
        public int NotSubmittedCount { get; set; }
        public decimal ExcludingTax { get; set; }
        public decimal SalesTax { get; set; }
        public decimal AdvanceTax { get; set; }
        public decimal FurtherTax { get; set; }
        public decimal Total { get; set; }
    }
}
