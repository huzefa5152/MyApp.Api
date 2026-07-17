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
        /// <summary>Underlying invoice id — lets the UI act on the row (e.g. the transfer-to-next-month bulk action).</summary>
        public int InvoiceId { get; set; }
        /// <summary>Buyer id — supports the client filter / grouping.</summary>
        public int ClientId { get; set; }
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

    /// <summary>
    /// Request to move the STILL-UNCLASSIFIED invoices of a tax-sheet period
    /// onto a new date (typically the 1st of next month) — so the tax
    /// consultant can defer the invoices they didn't get to this filing
    /// period to the next one, in one action, instead of re-dating each bill
    /// by hand. The server recomputes the exact set the sheet shows (same
    /// period + client filter), so it always transfers what the user sees.
    /// </summary>
    public class TaxSheetTransferRequestDto
    {
        public int? Year { get; set; }
        public int? Month { get; set; }
        public DateTime? DateFrom { get; set; }
        public DateTime? DateTo { get; set; }
        public int? ClientId { get; set; }
        /// <summary>The date every transferred invoice is moved to (e.g. 2026-08-03).</summary>
        public DateTime TargetDate { get; set; }
    }

    /// <summary>Outcome of a tax-sheet transfer.</summary>
    public class TaxSheetTransferResultDto
    {
        public int Transferred { get; set; }
        public int Skipped { get; set; }
        public DateTime TargetDate { get; set; }
        /// <summary>Invoice numbers that were skipped (already submitted to FBR / cancelled) so the UI can explain.</summary>
        public List<string> SkippedInvoiceNumbers { get; set; } = new();
    }
}
