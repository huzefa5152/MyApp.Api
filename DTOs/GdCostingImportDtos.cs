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
    /// Wire vocabulary for the operator's choice, at the top of an import, of
    /// what a MATCHED (cost-only) line does to the opening balance it
    /// matches (Task 19). A string on the DTO for the same reason
    /// <see cref="GdCostingDispositionNames"/> is: it is what the frontend
    /// posts, and it travels unchanged from preview to commit.
    ///
    /// The gap this closes: the sheet was specified as a one-time backfill
    /// (SET a balance's cost), but it is actually run every month, and each
    /// month's GD can bring NEW goods. Overwriting the cost of an existing
    /// balance when a GD brings 200 more units silently drops those 200
    /// units — the operator must say, per import, which case this is.
    /// </summary>
    public static class GdCostingImportModeNames
    {
        /// <summary>
        /// Stock already on the books, never costed before — a one-time
        /// historical backfill. A matched line SETS the balance's
        /// ActualCostExcludingTax from this GD's own unit cost applied to
        /// the WHOLE balance quantity. Quantity and ValueExcludingTax are
        /// untouched. The default, and byte-identical to this feature's
        /// behaviour before Task 19 existed.
        /// </summary>
        public const string Backfill = "backfill";

        /// <summary>
        /// A monthly GD bringing NEW goods in addition to what a matched
        /// balance already holds. A matched line ADDS its own quantity,
        /// cost and selling value onto the balance, so the stored cost
        /// stays the total cost of the total quantity — a genuine weighted
        /// average per unit — rather than being replaced by this GD's own
        /// rate alone.
        /// </summary>
        public const string NewArrivals = "new-arrivals";

        /// <summary>
        /// Unrecognised, missing or null input resolves to
        /// <see cref="Backfill"/> — never to the more consequential
        /// <see cref="NewArrivals"/> — so a caller that omits this field
        /// entirely gets exactly today's behaviour rather than a mode that
        /// adds quantity nobody asked for.
        /// </summary>
        public static string Normalize(string? s) => (s ?? "").Trim().ToLowerInvariant() switch
        {
            NewArrivals => NewArrivals,
            _ => Backfill,
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
        /// balance, repeated on every line that fed it — not a per-line
        /// share of it. Meaning depends on the chosen
        /// <see cref="GdCostingImportModeNames"/>: under Backfill, the
        /// WHOLE balance's derived SET cost (this GD's unit cost applied to
        /// the balance's existing quantity); under New Arrivals, the
        /// balance's resulting TOTAL cost after this GD's own cost is ADDED
        /// to what is already there.
        /// </summary>
        public decimal DerivedActualCost { get; set; }

        /// <summary>Human explanation of the match — filled when there is
        /// something worth saying (quantities differ, no match, ambiguous);
        /// null on an unremarkable exact match.</summary>
        public string? MatchNote { get; set; }
    }

    /// <summary>
    /// One hand-typed consignment line — the "enter a line by hand" flow
    /// (Task 18) for a consignment that is just one row and isn't worth
    /// building a workbook for. Carries exactly the raw inputs a sheet row
    /// carries (compare <see cref="Helpers.ExcelImport.GdCostingSheetRow"/>),
    /// so <c>IGdCostingImportService.PreviewManualAsync</c> can build ONE such
    /// row and run it through the exact same match/cost/consignment pipeline
    /// a whole workbook goes through — same disposition, same match note,
    /// same arithmetic.
    ///
    /// There is no manual commit DTO: the preview this produces returns an
    /// ordinary <see cref="GdCostingPreviewDto"/>, and its
    /// Lines/FileSha256/FileName/FileSizeBytes feed straight into the
    /// existing <c>gd-costing/commit</c> endpoint, unchanged, exactly as a
    /// file-sourced preview's do.
    /// </summary>
    public class GdCostingManualLineDto
    {
        public string GdNumber { get; set; } = "";
        public DateTime? GdDate { get; set; }
        public string Description { get; set; } = "";
        public string HsCode { get; set; } = "";
        public decimal Quantity { get; set; }
        public string? Unit { get; set; }

        public decimal AssessedValue { get; set; }
        public decimal CustomsDuty { get; set; }
        public decimal Acd { get; set; }
        public decimal RegulatoryDuty { get; set; }
        public decimal Others { get; set; }
        public decimal SalesTaxRate { get; set; }
        public decimal AstRate { get; set; }
        public decimal IncomeTaxRate { get; set; }
        public decimal AddOnProfit { get; set; }

        /// <summary>Optional stated selling value, mirroring a sheet's own
        /// Selling Value column
        /// (<see cref="Helpers.ExcelImport.GdCostingMapping.GdCostingColumns.SellingValue"/>).
        /// Null when the operator wants the computed figure used as-is.</summary>
        public decimal? SellingValue { get; set; }
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

        /// <summary>
        /// One of <see cref="GdCostingImportModeNames"/>. Defaults to
        /// <see cref="GdCostingImportModeNames.Backfill"/>, so a caller that
        /// does not send this gets exactly the behaviour this feature had
        /// before Task 19: a matched (cost-only) line SETS the balance's
        /// cost. <see cref="GdCostingImportModeNames.NewArrivals"/> instead
        /// ADDS the matched line's quantity, cost and selling value onto
        /// the balance.
        ///
        /// Applies only to a matched (cost-only) line.
        /// <see cref="CreateMissingStock"/>'s unmatched-line path is
        /// unaffected by this field either way — new stock is created the
        /// same way regardless of which mode costed the rest of the sheet.
        ///
        /// Never trusted blindly: <c>GdCostingImportService.CommitAsync</c>
        /// still re-derives every match from server truth exactly as
        /// before; this field only changes what is DONE with a match once
        /// verified, never whether it is verified.
        /// </summary>
        public string Mode { get; set; } = GdCostingImportModeNames.Backfill;
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
