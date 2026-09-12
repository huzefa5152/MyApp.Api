using static MyApp.Api.Helpers.ImportCostingCalculator;

namespace MyApp.Api.Helpers.ExcelImport
{
    /// <summary>
    /// One resolved GD costing line. <see cref="Input"/> and
    /// <see cref="Computed"/> are exactly what was passed to, and returned
    /// from, <see cref="ImportCostingCalculator.Compute"/> — nothing here
    /// repeats that arithmetic.
    ///
    /// <see cref="SheetSellingValue"/> is the sheet's OWN figure, kept
    /// alongside <see cref="Computed"/>'s <c>SellingValue</c> rather than in
    /// place of it, precisely because the two are allowed to disagree — see
    /// <see cref="GdCostingSheetReader"/>.
    /// </summary>
    public sealed record GdCostingSheetRow(
        int SourceRow,
        string GdNumber,
        DateTime? GdDate,
        string Description,
        string HsCode,
        decimal Quantity,
        string? Unit,
        ImportCostingInput Input,
        ImportCosting Computed,
        decimal? SheetSellingValue);

    /// <summary>Every line the reader kept, plus a warning for every row it
    /// skipped and every figure it overrode — see
    /// <see cref="GdCostingSheetReader"/>.</summary>
    public sealed record GdCostingSheetResult(List<GdCostingSheetRow> Rows, List<string> Warnings);

    /// <summary>
    /// Turns one worksheet of a GD costing workbook into rows, against a
    /// resolved <see cref="GdCostingMapping"/>. The only place this sheet is
    /// read — it does not pick the sheet (the caller resolves that through
    /// <see cref="SheetSelector"/>, exactly as <c>Read(wb, sheet, mapping)</c>
    /// is called) or the layout (that is <see cref="GdCostingLayout"/> /
    /// a saved <see cref="GdCostingMapping"/>).
    /// </summary>
    public static class GdCostingSheetReader
    {
        public static GdCostingSheetResult Read(IImportedWorkbook wb, int sheet, GdCostingMapping mapping)
        {
            var rows = new List<GdCostingSheetRow>();
            var warnings = new List<string>();

            // Column numbers first, then the sheet's own headings correct
            // them (GdCostingMapping.Resolve). Relocation / collision notes
            // land in the same list the reader's own warnings do below, so an
            // operator reads one list for everything that was not read
            // exactly as the layout expected.
            var cols = mapping.Resolve(wb, sheet, warnings);

            var lastRow = wb.GetLastRow(sheet);

            // The heading row is never data, whatever FirstDataRow says
            // (CLAUDE.md 5b-3b) — a mapping whose FirstDataRow sits on or
            // before the heading row would otherwise read the headings
            // themselves as the sheet's first line.
            var firstRow = Math.Max(mapping.FirstDataRow, mapping.HeaderRow + 1);

            var blankStreak = 0;
            for (int r = firstRow; r <= lastRow; r++)
            {
                // 1. The GD number is what makes a row a line at all — every
                // real line repeats it. A blank cell belongs to no
                // consignment (a spacer row, a note, the sheet's
                // formatted-but-empty tail) and is skipped outright; enough
                // of them in a row means the data has genuinely ended.
                var gd = wb.GetString(sheet, r, cols.GdNumber).Trim();
                if (gd.Length == 0)
                {
                    if (++blankStreak >= mapping.BlankRowsEndData) break;
                    continue;
                }
                blankStreak = 0;

                // 2. Description, the sheet's own selling value, and the HS
                // code — the last read here (ahead of the brief's own step
                // order) because rule 3 below needs it too.
                var description = wb.GetString(sheet, r, cols.Description).Trim();
                var sheetSellingValue = ReadAmountOrNull(wb, sheet, r, cols.SellingValue);
                var hsCodeRaw = wb.GetString(sheet, r, cols.HsCode);
                var hsCode = GdCostingMapping.CleanHsCode(hsCodeRaw);

                // 3. A totals row carries the GD number and a summed cost but
                // no selling value — Alpha row 30 holds 18,816,870, the sum of
                // the 26 lines above it. Importing it would double the
                // consignment, so it is skipped, and every skip is a named
                // warning: a silently dropped row is how a wrong import
                // becomes a confident one.
                //
                // GdCostingMapping.LooksLikeTotalsRow only catches a BLANK
                // description — deliberately: its own totals.descOnly test
                // (scripts/gd_costing_harness/Program.cs) protects a
                // hypothetical real item literally named "Total" with a
                // genuine zero selling value, so that contract must not
                // change. But all three real workbooks print the word
                // "Total" as the DESCRIPTION of their own totals row, not a
                // blank one (checked by hand against the live files: Alpha
                // row 30; AY rows 33, 59; PAK rows 8, 18, 46, 66, 86, 105 —
                // nine rows, all labelled "Total", none blank). What every
                // one of those nine lacks, and every genuine line has, is an
                // HS code — GdCostingMapping.Parse already treats HsCode as
                // mandatory for exactly that reason (a consignment line
                // cannot be costed, still less classified against the HS
                // master later, with no tariff code). So a labelled totals
                // row is caught here by the same "no selling value" half
                // LooksLikeTotalsRow already uses, paired with "no HS code"
                // in place of "no description" — without touching
                // LooksLikeTotalsRow's own (deliberately different) contract.
                var noHsCode = string.IsNullOrWhiteSpace(hsCodeRaw);
                if (GdCostingMapping.LooksLikeTotalsRow(description, sheetSellingValue)
                    || (noHsCode && !(sheetSellingValue > 0m)))
                {
                    warnings.Add($"Row {r}: a totals row for {gd} was skipped (no description, no selling value).");
                    continue;
                }

                var gdDate = cols.GdDate is > 0 ? wb.GetDate(sheet, r, cols.GdDate.Value) : null;
                var quantity = wb.GetDecimal(sheet, r, cols.Quantity) ?? 0m;
                var unitText = cols.Unit is > 0 ? wb.GetString(sheet, r, cols.Unit.Value).Trim() : "";
                var unit = unitText.Length > 0 ? unitText : null;

                // 4. Rates go through PercentRate so a fraction, a percent
                // string and a whole number all land as the same percentage —
                // the three real workbooks write all three, sometimes in the
                // same column (CLAUDE.md 5b-3b's tax-rate lesson, repeated
                // here column by column). An unmapped optional column reads
                // as zero: nothing to add is indistinguishable from an
                // add-nothing column, as far as the costing chain is concerned.
                var input = new ImportCostingInput(
                    AssessedValue: ReadAmount(wb, sheet, r, cols.AssessedValue),
                    CustomsDuty: ReadAmount(wb, sheet, r, cols.CustomsDuty),
                    Acd: ReadAmount(wb, sheet, r, cols.Acd),
                    RegulatoryDuty: ReadAmount(wb, sheet, r, cols.RegulatoryDuty),
                    Others: ReadAmount(wb, sheet, r, cols.Others),
                    SalesTaxRate: ReadRate(wb, sheet, r, cols.SalesTaxRate),
                    AstRate: ReadRate(wb, sheet, r, cols.AstRate),
                    IncomeTaxRate: ReadRate(wb, sheet, r, cols.IncomeTaxRate),
                    AddOnProfit: ReadAmount(wb, sheet, r, cols.AddOnProfit));

                // 5. The one place this chain is computed — see
                // ImportCostingCalculator's own doc comment for the formula.
                var computed = Compute(input);

                // 6. The sheet's stated selling value wins when it disagrees
                // with the computed one by more than a paisa: nine of PAK's
                // 83 lines carry a typed override the formula does not
                // reproduce, and the sheet is the operator's own figure, not
                // a rounding artefact to be corrected away.
                if (sheetSellingValue.HasValue
                    && Math.Abs(sheetSellingValue.Value - computed.SellingValue) > 0.01m)
                {
                    warnings.Add(
                        $"Row {r}: the sheet states a selling value of {sheetSellingValue.Value:N2} " +
                        $"where the costing gives {computed.SellingValue:N2}. The sheet's figure was kept.");
                }

                rows.Add(new GdCostingSheetRow(
                    r, gd, gdDate, description, hsCode, quantity, unit, input, computed, sheetSellingValue));
            }

            return new GdCostingSheetResult(rows, warnings);
        }

        private static decimal ReadAmount(IImportedWorkbook wb, int sheet, int row, int? col) =>
            col is > 0 ? wb.GetDecimal(sheet, row, col.Value) ?? 0m : 0m;

        private static decimal? ReadAmountOrNull(IImportedWorkbook wb, int sheet, int row, int? col) =>
            col is > 0 ? wb.GetDecimal(sheet, row, col.Value) : null;

        private static decimal ReadRate(IImportedWorkbook wb, int sheet, int row, int? col) =>
            col is > 0
                ? PercentRate.ToPercent(wb.GetDecimal(sheet, row, col.Value), wb.GetString(sheet, row, col.Value)) ?? 0m
                : 0m;
    }
}
