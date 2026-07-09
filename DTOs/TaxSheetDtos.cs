namespace MyApp.Api.DTOs
{
    /// <summary>
    /// One row of the Tax Sheet — a single (invoice, un-classified item type)
    /// group. Every row is a line whose item type has NO valid HS code yet, so
    /// the tax consultant knows which invoices still need HS classification.
    /// The "HS Code" column deliberately shows the item-type NAME (e.g.
    /// "Pneumatic Item") — that's the placeholder the consultant maps to a
    /// real HS code.
    /// </summary>
    public class TaxSheetRowDto
    {
        public string Ntn { get; set; } = "";
        public string PartyName { get; set; } = "";
        public string DocumentNumber { get; set; } = "";
        public DateTime DocumentDate { get; set; }
        /// <summary>Total quantity for this item type on the invoice, unit-suffixed (e.g. "50 ft", "60").</summary>
        public string QuantityLabel { get; set; } = "";
        public decimal Quantity { get; set; }
        /// <summary>Un-classified item-type name — shown under the "HS Code" column.</summary>
        public string ItemTypeName { get; set; } = "";
        public decimal ExcludingAmount { get; set; }
        public decimal SalesTax { get; set; }
        public decimal Total { get; set; }
    }

    /// <summary>
    /// Tax Sheet report: every invoice line still missing a valid HS code,
    /// over a period, so they can be sent to the tax consultant for
    /// classification. Same period controls as the Sales report.
    /// </summary>
    public class TaxSheetReportDto
    {
        public int CompanyId { get; set; }
        public string CompanyName { get; set; } = "";
        public int? Year { get; set; }
        public int? Month { get; set; }
        public DateTime DateFrom { get; set; }
        public DateTime DateTo { get; set; }
        public string PeriodLabel { get; set; } = "";

        public List<TaxSheetRowDto> Rows { get; set; } = new();

        public decimal GrandExcluding { get; set; }
        public decimal GrandTax { get; set; }
        public decimal GrandTotal { get; set; }
        /// <summary>Distinct invoices that still need HS classification.</summary>
        public int InvoiceCount { get; set; }
        public int RowCount { get; set; }
    }
}
