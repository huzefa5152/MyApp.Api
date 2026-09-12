namespace MyApp.Api.DTOs
{
    /// <summary>
    /// Wire vocabulary for <see cref="Models.GdCostingDisposition"/> — a string
    /// on the DTO (unlike the model's enum) for the same reason
    /// <c>OpeningStockRowStatus</c> is a string: it is what the frontend reads
    /// and posts back, and a string is what a reviewed-row round trip carries.
    /// </summary>
    public static class GdCostingDispositionNames
    {
        /// <summary>Matched exactly one opening balance; only its actual cost
        /// was (or will be) written.</summary>
        public const string CostOnly = "cost-only";

        /// <summary>No existing balance under this HS code — this reads as new
        /// stock. Round 1 cannot post it; commit downgrades it to
        /// <see cref="Skipped"/> with a reason.</summary>
        public const string StockPosted = "stock-posted";

        /// <summary>Read and recorded, but nothing was written.</summary>
        public const string Skipped = "skipped";

        /// <summary>Matched more than one distinct opening balance. No guess
        /// was made.</summary>
        public const string Ambiguous = "ambiguous";

        public static string From(Models.GdCostingDisposition d) => d switch
        {
            Models.GdCostingDisposition.CostOnly => CostOnly,
            Models.GdCostingDisposition.StockPosted => StockPosted,
            Models.GdCostingDisposition.Ambiguous => Ambiguous,
            _ => Skipped,
        };

        public static Models.GdCostingDisposition Parse(string? s) => (s ?? "").Trim().ToLowerInvariant() switch
        {
            CostOnly => Models.GdCostingDisposition.CostOnly,
            StockPosted => Models.GdCostingDisposition.StockPosted,
            Ambiguous => Models.GdCostingDisposition.Ambiguous,
            _ => Models.GdCostingDisposition.Skipped,
        };
    }

    /// <summary>
    /// One consignment line, as read and matched. Carries BOTH the raw cost
    /// inputs and the resolved costing chain (mirrors what
    /// <c>Models.ImportConsignmentLine</c> stores — CLAUDE.md's own reasoning
    /// for that entity: a later reconciliation must reproduce exactly what was
    /// posted, not a rate that may have since moved on) plus the matching
    /// outcome Task 10 adds on top.
    ///
    /// Used for BOTH the preview response and the commit request: preview
    /// produces this shape, and the commit body echoes it back (possibly with
    /// an operator-adjusted <see cref="Disposition"/>) — never re-reading the
    /// file, exactly as <c>OpeningStockCommitRowDto</c> does not re-read the
    /// stock sheet.
    /// </summary>
    public class GdCostingLineDto
    {
        public int SourceRow { get; set; }
        public string GdNumber { get; set; } = "";
        public DateTime? GdDate { get; set; }
        public string Description { get; set; } = "";
        public string HsCode { get; set; } = "";
        public decimal Quantity { get; set; }
        public string? Unit { get; set; }

        // Raw cost inputs, exactly as ImportCostingCalculator.ImportCostingInput
        // — stored on ImportConsignmentLine so history never depends on a rate
        // that has since been republished.
        public decimal AssessedValue { get; set; }
        public decimal CustomsDuty { get; set; }
        public decimal Acd { get; set; }
        public decimal RegulatoryDuty { get; set; }
        public decimal Others { get; set; }
        public decimal SalesTaxRate { get; set; }
        public decimal AstRate { get; set; }
        public decimal IncomeTaxRate { get; set; }
        public decimal AddOnProfit { get; set; }

        // Resolved by ImportCostingCalculator.Compute — see its own doc comment
        // for the formula. Kept exactly as computed (or as the sheet overrode
        // SellingValue — see SheetSellingValue).
        public decimal Cost { get; set; }
        public decimal SalesTax { get; set; }
        public decimal Ast { get; set; }
        public decimal Subtotal { get; set; }
        public decimal IncomeTax { get; set; }
        public decimal InputTax { get; set; }
        public decimal SellingValue { get; set; }

        /// <summary>The sheet's OWN selling value when it disagrees with
        /// <see cref="SellingValue"/> by more than a paisa — see
        /// <c>GdCostingSheetReader</c>. Null when the sheet had none, or agreed.</summary>
        public decimal? SheetSellingValue { get; set; }

        // ── Matching outcome (Task 10) ──────────────────────────────────────

        /// <summary>One of <see cref="GdCostingDispositionNames"/>.</summary>
        public string Disposition { get; set; } = GdCostingDispositionNames.Skipped;

        /// <summary>The opening balance this line matched, when exactly one did.</summary>
        public int? OpeningStockBalanceId { get; set; }
        public int? ItemTypeId { get; set; }
        public string? ItemTypeName { get; set; }

        /// <summary>The matched balance's OWN quantity (not this line's) — the
        /// "3,450" in "covers 2,030 of the 3,450 on the books".</summary>
        public decimal MatchedBalanceQuantity { get; set; }

        /// <summary>
        /// The actual cost that would be (or was) written onto the matched
        /// balance — the WHOLE balance's derived cost, repeated on every line
        /// that fed it, not a per-line share of it.
        /// </summary>
        public decimal DerivedActualCost { get; set; }

        /// <summary>Human explanation of the match — filled when there is
        /// something worth saying (quantities differ, no match, ambiguous);
        /// null on an unremarkable exact match.</summary>
        public string? MatchNote { get; set; }
    }

    /// <summary>Per-GD totals, shown above the line table so the operator can
    /// check a consignment's own arithmetic before trusting any one line.</summary>
    public class GdCostingConsignmentTotalsDto
    {
        public string GdNumber { get; set; } = "";
        public DateTime? GdDate { get; set; }
        public int LineCount { get; set; }
        public decimal TotalCostExcludingTax { get; set; }
        public decimal TotalSalesTax { get; set; }
        public decimal TotalAst { get; set; }
        public decimal TotalIncomeTax { get; set; }
        public decimal TotalInputTax { get; set; }
        public decimal TotalSellingValue { get; set; }
    }

    public class GdCostingPreviewDto
    {
        public string FileName { get; set; } = "";
        public string FileSha256 { get; set; } = "";
        public long FileSizeBytes { get; set; }
        public int? ImportProfileId { get; set; }
        public int? ProfileVersion { get; set; }

        public List<GdCostingLineDto> Lines { get; set; } = new();
        public List<GdCostingConsignmentTotalsDto> Consignments { get; set; } = new();

        /// <summary>Counts per <see cref="GdCostingDispositionNames"/> value —
        /// the "71 matched, 12 unmatched, 0 ambiguous" summary line.</summary>
        public Dictionary<string, int> DispositionCounts { get; set; } = new();

        /// <summary>Lines read, before anything was blocked. Equal to
        /// <c>Lines.Count</c> here — GD costing rows are never grouped the way
        /// opening-stock lots are — kept for symmetry with
        /// <c>OpeningStockPreviewDto</c> and so a future change that DOES group
        /// has somewhere to show the difference.</summary>
        public int SourceRowCount { get; set; }

        /// <summary>Commit is refused while this is non-empty.</summary>
        public List<string> BlockingErrors { get; set; } = new();
        public List<string> Warnings { get; set; } = new();

        public bool CanCommit => BlockingErrors.Count == 0 && Lines.Count > 0;
    }

    /// <summary>
    /// Commit takes the REVIEWED lines, never re-reads the file — what the
    /// operator approved on screen is exactly what lands. Mirrors
    /// <c>OpeningStockCommitDto</c>'s shape.
    /// </summary>
    public class GdCostingCommitDto
    {
        public int CompanyId { get; set; }
        public int? ImportProfileId { get; set; }
        public int? ProfileVersion { get; set; }

        public string FileSha256 { get; set; } = "";
        public string FileName { get; set; } = "";
        public long FileSizeBytes { get; set; }

        public List<GdCostingLineDto> Lines { get; set; } = new();

        /// <summary>
        /// Opt-in, default false (Task 15). When true, a line the SERVER'S
        /// OWN re-derivation confirms matches nothing on the books (see
        /// <c>GdCostingImportService.CommitAsync</c>) is turned into new
        /// stock — an ItemType (reused/adopted when one already carries the
        /// same HS code AND name, else newly created — CLAUDE.md 5b-2/5b-3)
        /// plus an OpeningStockBalance — instead of being skipped. When
        /// false, behaviour is byte-identical to before this field existed:
        /// every <c>stock-posted</c> line is skipped with "Posting new stock
        /// arrives in a later release."
        ///
        /// Never trusted from the claimed <see cref="GdCostingLineDto.Disposition"/>
        /// alone — a line the client marks "stock-posted" that the server's
        /// own match resolves to exactly one balance is written as CostOnly
        /// regardless, and one that resolves to more than one is Ambiguous,
        /// never created.
        /// </summary>
        public bool CreateMissingStock { get; set; }
    }

    public class GdCostingCommitResultDto
    {
        public int ImportRunId { get; set; }
        public int ConsignmentsWritten { get; set; }
        public int LinesWritten { get; set; }

        /// <summary>Opening balances whose <c>ActualCostExcludingTax</c> was set.</summary>
        public int BalancesCosted { get; set; }

        public int LinesSkipped { get; set; }
        public int LinesAmbiguous { get; set; }
        public decimal TotalCostExcludingTax { get; set; }

        /// <summary>New ItemType rows created for unmatched lines — only
        /// possible when <see cref="GdCostingCommitDto.CreateMissingStock"/>
        /// was set.</summary>
        public int ItemTypesCreated { get; set; }

        /// <summary>Existing HS-tariff placeholder ItemTypes (IsAutoGenerated,
        /// not yet IsFavorite) adopted rather than duplicated, because their
        /// name already matched the sheet's line.</summary>
        public int ItemTypesAdopted { get; set; }

        /// <summary>New OpeningStockBalance rows created for unmatched lines.</summary>
        public int OpeningBalancesCreated { get; set; }

        public List<string> Messages { get; set; } = new();
    }
}
