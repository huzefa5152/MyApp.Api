namespace MyApp.Api.DTOs
{
    /// <summary>
    /// One line on the Sales report. Mirrors the columns of the legacy
    /// paint-shop "Sale Report" (Sr / FBR Inv. No / Doc. No / HS Code /
    /// Product / Customer / Quantity / Unit / Rate / Amount / Dis Amount /
    /// Tax Amount / Total Amount).
    ///
    /// Quantity / Unit / Rate / HS Code reflect the DUAL-BOOK overlay:
    /// when the operator ran tax-claim optimization the FBR-filed values
    /// (<see cref="Models.InvoiceItemAdjustment"/>) are shown, since the
    /// report is a picture of what was SUBMITTED to FBR — not what the
    /// bill printed. Amount is tax-exclusive; TaxAmount uses the same
    /// per-line math FBR submission uses; TotalAmount = Amount + Tax.
    /// </summary>
    public class SalesReportLineDto
    {
        public int Sr { get; set; }
        public string HsCode { get; set; } = "";
        public string Product { get; set; } = "";
        public decimal Quantity { get; set; }
        public string Unit { get; set; } = "";
        public decimal Rate { get; set; }
        public decimal Amount { get; set; }
        public decimal DiscountAmount { get; set; }
        public decimal TaxAmount { get; set; }
        public decimal TotalAmount { get; set; }
    }

    /// <summary>
    /// One invoice (document number) group: its header info plus every line
    /// filed under it, with the invoice's own totals. The report is grouped
    /// by this so the UI / Excel can expand a Doc No to reveal its items.
    /// </summary>
    public class SalesReportInvoiceDto
    {
        public string DocumentNumber { get; set; } = "";
        public string FbrInvoiceNumber { get; set; } = "";
        public DateTime DocumentDate { get; set; }
        public string Customer { get; set; } = "";
        public List<SalesReportLineDto> Lines { get; set; } = new();
        public decimal TotalQuantity { get; set; }
        public decimal TotalAmount { get; set; }
        public decimal TotalDiscount { get; set; }
        public decimal TotalTax { get; set; }
        public decimal TotalGross { get; set; }
        public int LineCount { get; set; }
    }

    /// <summary>
    /// The full Sales report for one company over a period, grouped by
    /// invoice (document number), with a grand total across all invoices.
    /// </summary>
    public class SalesReportDto
    {
        public int CompanyId { get; set; }
        public string CompanyName { get; set; } = "";
        /// <summary>Null when a custom date range was used instead of month/year.</summary>
        public int? Year { get; set; }
        /// <summary>1–12 for a single month; null = full-year or custom-range view.</summary>
        public int? Month { get; set; }
        /// <summary>Resolved window start (inclusive) — set for every mode.</summary>
        public DateTime DateFrom { get; set; }
        /// <summary>Resolved window end (inclusive) — set for every mode.</summary>
        public DateTime DateTo { get; set; }
        /// <summary>Human label for the period, e.g. "June 2026" or "01-06-2026 – 15-06-2026".</summary>
        public string PeriodLabel { get; set; } = "";
        /// <summary>"unregistered" (walk-in) | "registered" | "all".</summary>
        public string BuyerType { get; set; } = "all";

        public List<SalesReportInvoiceDto> Invoices { get; set; } = new();

        public decimal GrandQuantity { get; set; }
        public decimal GrandAmount { get; set; }
        public decimal GrandDiscount { get; set; }
        public decimal GrandTax { get; set; }
        public decimal GrandTotal { get; set; }
        public int InvoiceCount { get; set; }
        public int LineCount { get; set; }
    }
}
