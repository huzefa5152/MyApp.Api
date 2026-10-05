namespace MyApp.Api.DTOs
{
    /// <summary>The importer's monthly sales-tax worksheet (Helpers/InputTaxWorksheet).</summary>
    public class InputTaxWorksheetDto
    {
        public string CompanyName { get; set; } = "";
        public DateTime From { get; set; }
        public DateTime To { get; set; }
        public decimal CapPercent { get; set; }
        public int ClaimPeriods { get; set; }
        public List<InputTaxMonthDto> Months { get; set; } = new();
        public List<InputTaxTimeLimitDto> TimeLimit { get; set; } = new();
        public decimal LapsedInputTax { get; set; }
        public decimal OpenInputTax { get; set; }
        /// <summary>GD lines with input tax but no claim month at all.</summary>
        public int UnclaimedLineCount { get; set; }
    }

    public class InputTaxMonthDto
    {
        public DateTime Month { get; set; }
        public decimal OutputTax { get; set; }
        public decimal ImportSalesTax { get; set; }
        public decimal ImportValueAddedTax { get; set; }
        public decimal ImportOtherTax { get; set; }
        public decimal PurchaseInputTax { get; set; }
        public decimal InputThisMonth { get; set; }
        public decimal BroughtForward { get; set; }
        public decimal Available { get; set; }
        public decimal CapLimit { get; set; }
        public decimal Admissible { get; set; }
        public decimal CarriedForward { get; set; }
        public decimal Payable { get; set; }
        public bool CapApplied { get; set; }
    }

    public class InputTaxTimeLimitDto
    {
        public string GdNumber { get; set; } = "";
        public DateTime GdDate { get; set; }
        public DateTime? ClaimMonth { get; set; }
        public string Description { get; set; } = "";
        public string? HsCode { get; set; }
        public decimal InputTax { get; set; }
        public DateTime ClaimBy { get; set; }
        /// <summary>lapsed | open | claimed-late</summary>
        public string Status { get; set; } = "";
    }

    /// <summary>One line of the GD register: a GD costing line, or a GD line
    /// that only exists on the stock sheet the company was loaded from.</summary>
    public class GdRegisterLineDto
    {
        /// <summary>gd-costing | stock-sheet</summary>
        public string Source { get; set; } = "";
        public int? ConsignmentId { get; set; }
        public string GdNumber { get; set; } = "";
        public string? Collectorate { get; set; }
        public string? CollectorateName { get; set; }
        public string? GdType { get; set; }
        public string? GdTypeName { get; set; }
        public DateTime? GdDate { get; set; }
        public DateTime? ClaimMonth { get; set; }
        public DateTime? ClaimBy { get; set; }
        /// <summary>claimed | open | lapsed | claimed-late | n/a (no tax figures)</summary>
        public string ClaimStatus { get; set; } = "";
        public string Description { get; set; } = "";
        public string? ItemName { get; set; }
        public string? HsCode { get; set; }
        public decimal Quantity { get; set; }
        public string? Unit { get; set; }
        public decimal AssessedValue { get; set; }
        public decimal CustomsDuty { get; set; }
        public decimal Acd { get; set; }
        public decimal RegulatoryDuty { get; set; }
        public decimal SalesTaxRate { get; set; }
        public decimal SalesTax { get; set; }
        public decimal AstRate { get; set; }
        public decimal ValueAddedTax { get; set; }
        public decimal OtherTax { get; set; }
        public decimal IncomeTaxRate { get; set; }
        public decimal IncomeTax { get; set; }
        /// <summary>This line's share of the GD's freight / clearing / other charges.</summary>
        public decimal Charges { get; set; }
        /// <summary>Landed cost INCLUDING <see cref="Charges"/>.</summary>
        public decimal LandedCost { get; set; }
        public decimal InputTax { get; set; }
        public decimal SellingValue { get; set; }
        public string? Mode { get; set; }
    }

    public class GdRegisterDto
    {
        public string CompanyName { get; set; } = "";
        public DateTime? From { get; set; }
        public DateTime? To { get; set; }
        public bool UnclaimedOnly { get; set; }
        public int ClaimPeriods { get; set; }
        public List<GdRegisterLineDto> Lines { get; set; } = new();
        public int GdCount { get; set; }
        public decimal TotalAssessedValue { get; set; }
        public decimal TotalDuties { get; set; }
        public decimal TotalSalesTax { get; set; }
        public decimal TotalValueAddedTax { get; set; }
        public decimal TotalIncomeTax { get; set; }
        public decimal TotalLandedCost { get; set; }
        public decimal TotalInputTax { get; set; }
        public decimal UnclaimedInputTax { get; set; }
    }

    /// <summary>The month-end tie-out: the stock screen, the general ledger and
    /// the Annex-H1 statement must tell one story.</summary>
    public class StockTieOutDto
    {
        public DateTime Month { get; set; }
        public bool LedgerOn { get; set; }
        public bool Fifo { get; set; }
        public decimal StockValue { get; set; }
        public decimal? LedgerInventory { get; set; }
        public decimal? AnnexH1Closing { get; set; }
        public decimal? StockVsLedger { get; set; }
        public decimal? StockVsAnnexH1 { get; set; }
        /// <summary>Declared value less landed cost of the posted New Arrivals
        /// GDs: the part of <see cref="StockVsLedger"/> the two bases explain.</summary>
        public decimal ArrivalsBasisGap { get; set; }
        public decimal? UnexplainedLedgerDifference { get; set; }
        public decimal ConsignmentsOutstanding { get; set; }
        public decimal? LedgerImportClearing { get; set; }
        public decimal? ClearingDifference { get; set; }
        public bool Agrees { get; set; }
        /// <summary>True when the only difference is <see cref="ArrivalsBasisGap"/>.</summary>
        public bool AgreesOnceExplained { get; set; }
        public List<string> Notes { get; set; } = new();
    }
}
