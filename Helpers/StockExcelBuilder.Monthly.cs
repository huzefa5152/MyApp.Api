using ClosedXML.Excel;
using MyApp.Api.DTOs;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// The MONTHLY stock sheet, as the importer clients keep it month by month:
    /// one row per GD line (GD x product) with its HS code and value, in the
    /// same columns, bands, widths and formulas as the on-hand export -- only
    /// the row grain and the period differ.
    ///
    ///  • Opening = the line's position on the first of the month (a line that
    ///    arrived during the month opens at what it brought in), Consumed = what
    ///    that month's sales took from it at FIFO cost, Balance = its position at
    ///    month end. Balance is written as a VALUE from the walk, never =J-N, for
    ///    the reason the on-hand sheet gives (§5b-9): a revaluation or a
    ///    restatement inside the month moves value without a sale, and the sheet
    ///    must agree with the stock screen rather than with its own subtraction.
    ///  • A month's Balance is the next month's Opening by construction: both
    ///    come from the same walk cut at the same date.
    /// </summary>
    public static partial class StockExcelBuilder
    {
        public static byte[] BuildMonthly(StockMonthlyExportDto data)
        {
            using var wb = new XLWorkbook();
            var ws = wb.Worksheets.Add(SheetName(data.Month));

            WriteCogsTitle(ws);
            WriteBandLabels(ws);
            WriteHeader(ws);

            var r = FirstDataRow;
            var truncated = false;
            foreach (var line in data.Lines)
            {
                if (r > MaxRows) { truncated = true; break; }
                WriteMonthlyRow(ws, r, line);
                r++;
            }
            var lastDataRow = r - 1;
            WriteTotals(ws, lastDataRow + 3, lastDataRow);

            ApplyWidths(ws);
            ws.SheetView.FreezeRows(HeaderRow);
            ws.PageSetup.PageOrientation = XLPageOrientation.Landscape;
            ws.PageSetup.FitToPages(1, 0);
            ws.PageSetup.SetRowsToRepeatAtTop(HeaderRow, HeaderRow);
            ws.PageSetup.Margins.Left = 0.3;
            ws.PageSetup.Margins.Right = 0.3;

            WriteMonthlySummary(wb, data, truncated);
            WriteByHsSheet(wb, data);

            using var ms = new MemoryStream();
            wb.SaveAs(ms);
            return ms.ToArray();
        }

        private static void WriteMonthlyRow(IXLWorksheet ws, int r, StockMonthlyLineDto l)
        {
            if (l.ClaimMonth.HasValue)
                Text(ws, r, CClaim, l.ClaimMonth.Value.ToString("MMM yyyy",
                    System.Globalization.CultureInfo.InvariantCulture));
            Text(ws, r, CGdNo, l.GdNumber);
            if (l.GdDate.HasValue) Date(ws, r, CGdDate, l.GdDate.Value);
            Text(ws, r, CItem, l.Description);
            foreach (var col in new[] { CItem, CGdNo, CUnit, CClaim })
            {
                ws.Cell(r, col).Style.Alignment.WrapText = true;
                ws.Cell(r, col).Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
            }

            Formula(ws, r, CHs4, $"LEFT(G{r},4)", Acct0);
            Text(ws, r, CHs8, l.HsCode);
            Formula(ws, r, CPrice, $"IFERROR(K{r}/J{r},\"\")", Acct0);
            Text(ws, r, CUnit, l.Unit);

            var rate = l.SalesTaxRate / 100m;
            Number(ws, r, COpenQty, l.OpeningQuantity, Acct0);
            Number(ws, r, COpenExl, l.OpeningValueExcludingTax, Acct0);
            Number(ws, r, COpenRate, rate, Pct);
            Formula(ws, r, COpenTax, $"L{r}*K{r}", Acct2);

            Number(ws, r, CConsQty, l.ConsumedQuantity, Acct0);
            Number(ws, r, CConsExl, l.ConsumedValueExcludingTax, Acct0);
            Formula(ws, r, CConsRate, $"L{r}", Pct);
            Formula(ws, r, CConsTax, $"O{r}*P{r}", Acct0);

            Number(ws, r, CBalQty, l.BalanceQuantity, Acct0);
            Number(ws, r, CBalExl, l.BalanceValueExcludingTax, Acct0);
            Number(ws, r, CBalRate, rate, Pct);
            Formula(ws, r, CBalTax, $"S{r}*T{r}", Acct0);

            ws.Cell(r, CStripe).Style.Fill.BackgroundColor = SeparatorFill;

            // Cost of Good Sold: measured where the line carries a landed cost,
            // the client's own unwinding of the tax uplift where it does not --
            // the same two shapes, and the same AD = X - AA, as the on-hand sheet.
            if (l.OpeningActualCostExcludingTax.HasValue || l.BalanceActualCostExcludingTax.HasValue)
            {
                Number(ws, r, CCogsOpenExl, l.OpeningActualCostExcludingTax ?? 0m, Acct0);
                Number(ws, r, CCogsBalExl, l.BalanceActualCostExcludingTax ?? 0m, Acct2);
                Formula(ws, r, CCogsConsExl, $"X{r}-AD{r}", Acct0);
            }
            else
            {
                Formula(ws, r, CCogsOpenExl, $"IF(L{r}=0,K{r},K{r}*L{r}/(L{r}+{VatRate}))", Acct0);
                Formula(ws, r, CCogsConsExl, $"IF(L{r}=0,O{r},Q{r}/(L{r}+{VatRate}))", Acct0);
                Formula(ws, r, CCogsBalExl, $"X{r}-AA{r}", Acct2);
            }
            Formula(ws, r, CCogsOpenTax, $"X{r}*L{r}", Acct2);
            Formula(ws, r, CCogsOpenVat, $"X{r}*{VatRate}", Acct0);
            Formula(ws, r, CCogsConsTax, $"AA{r}*L{r}", Acct0);
            Formula(ws, r, CCogsConsVat, $"AA{r}*{VatRate}", Acct0);
            Formula(ws, r, CCogsBalTax, $"Y{r}-AB{r}", Acct2);
            Formula(ws, r, CCogsBalVat, $"Z{r}-AC{r}", Acct2);

            foreach (var col in new[] { COpenQty, CCogsOpenExl })
                ws.Cell(r, col).Style.Border.LeftBorder = XLBorderStyleValues.Medium;
            foreach (var col in new[] { COpenTax, CConsTax, CBalTax,
                                        CCogsOpenVat, CCogsConsVat, CCogsBalVat })
                ws.Cell(r, col).Style.Border.RightBorder = XLBorderStyleValues.Medium;
            ws.Range(r, CClaim, r, Cols).Style.Font.SetFontName(Face);
        }

        private static void WriteMonthlySummary(XLWorkbook wb, StockMonthlyExportDto data, bool truncated)
        {
            var ws = wb.Worksheets.Add("Summary");
            var r = 1;
            ws.Cell(r, 1).Value = Safe(data.CompanyName);
            ws.Cell(r, 1).Style.Font.SetBold().Font.SetFontSize(14).Font.SetFontColor(Navy);
            r++;
            ws.Cell(r++, 1).Value = "Stock Sheet";
            ws.Cell(r, 1).Value = SheetName(data.Month);
            r += 2;

            foreach (var (label, value) in new (string, decimal)[]
            {
                ("Opening (excluding tax)", data.Lines.Sum(l => l.OpeningValueExcludingTax)),
                ("Consumed (excluding tax)", data.Lines.Sum(l => l.ConsumedValueExcludingTax)),
                ("Balance (excluding tax)", data.Lines.Sum(l => l.BalanceValueExcludingTax)),
            })
            {
                ws.Cell(r, 1).Value = label;
                ws.Cell(r, 1).Style.Font.SetBold();
                ws.Cell(r, 2).Value = value;
                ws.Cell(r, 2).Style.NumberFormat.Format = "#,##0.00";
                r++;
            }
            r++;

            var lines = new List<string>(data.FiltersApplied)
            {
                $"{data.Lines.Count:N0} GD line{(data.Lines.Count == 1 ? "" : "s")}",
                $"Generated {data.GeneratedAt:dd-MM-yyyy HH:mm}",
            };
            if (data.LaterLinesOmitted > 0)
                lines.Add($"{data.LaterLinesOmitted:N0} GD line(s) dated after this month left out "
                    + $"(value {data.LaterLinesValue:N2}); they appear from their own month.");
            if (data.RestatedInMonth)
                lines.Add("A stock-sheet restatement was applied this month: the lines it replaced close at nil and the restated lines open at nil, so on those lines Balance is not Opening minus Consumed.");
            if (truncated)
                lines.Add($"TRUNCATED at {MaxRows:N0} rows — narrow the search for a complete export.");
            foreach (var line in lines)
            {
                ws.Cell(r, 1).Value = Safe(line);
                ws.Cell(r, 1).Style.Font.SetItalic().Font.SetFontColor(Muted);
                r++;
            }
            r++;
            foreach (var note in new[]
            {
                "One row per GD line: a product on a GD, with its own HS code and value.",
                "Opening is the line's position on the first of the month; a GD that arrived during the month opens at what it brought in.",
                "Consumed is what this month's sales took from the line, at FIFO cost: claimed GDs first, oldest GD date first.",
                "Balance is the line's position at month end, from the stock valuation — next month's Opening.",
                "Cost of Good Sold uses the GD landed cost where one exists; otherwise cost = value x rate / (rate + 3%).",
                "Sub cat is yours to fill. A Claim Month is the filed period, never inferred from the GD date.",
            })
            {
                ws.Cell(r, 1).Value = note;
                ws.Cell(r, 1).Style.Font.SetItalic().Font.SetFontSize(9).Font.SetFontColor(Muted);
                r++;
            }
            ws.Column(1).Width = 90;
            ws.Column(2).Width = 20;
        }

        /// <summary>The client's second sheet: Balance excluding tax by 4-digit
        /// HS heading, then by product, with a grand total.</summary>
        private static void WriteByHsSheet(XLWorkbook wb, StockMonthlyExportDto data)
        {
            var ws = wb.Worksheets.Add("By HS");
            ws.Cell(1, 1).Value = Safe(data.CompanyName);
            ws.Cell(1, 1).Style.Font.SetBold().Font.SetFontSize(14).Font.SetFontColor(Navy);
            ws.Cell(2, 1).Value = "Stock Sheet";
            ws.Cell(3, 1).Value = SheetName(data.Month);
            ws.Cell(5, 1).Value = "Row Labels";
            ws.Cell(5, 2).Value = "Excluding";
            ws.Range(5, 1, 5, 2).Style.Font.SetBold().Border.BottomBorder = XLBorderStyleValues.Thin;

            var r = 6;
            static string Hs4(string? hs)
            {
                var digits = new string((hs ?? "").Where(char.IsDigit).ToArray());
                return digits.Length >= 4 ? digits[..4] : (digits.Length > 0 ? digits : "No HS code");
            }
            foreach (var g in data.Lines.GroupBy(l => Hs4(l.HsCode)).OrderBy(g => g.Key, StringComparer.Ordinal))
            {
                ws.Cell(r, 1).Value = g.Key;
                ws.Cell(r, 1).Style.Font.SetBold();
                r++;
                foreach (var p in g.GroupBy(l => l.Description.Trim(), StringComparer.OrdinalIgnoreCase)
                             .OrderBy(p => p.Key, StringComparer.OrdinalIgnoreCase))
                {
                    ws.Cell(r, 1).Value = Safe(p.Key);
                    ws.Cell(r, 1).Style.Alignment.Indent = 1;
                    ws.Cell(r, 2).Value = p.Sum(l => l.BalanceValueExcludingTax);
                    ws.Cell(r, 2).Style.NumberFormat.Format = "#,##0.00";
                    r++;
                }
            }
            ws.Cell(r, 1).Value = "Grand Total";
            ws.Cell(r, 2).Value = data.Lines.Sum(l => l.BalanceValueExcludingTax);
            ws.Cell(r, 2).Style.NumberFormat.Format = "#,##0.00";
            ws.Range(r, 1, r, 2).Style.Font.SetBold().Border.TopBorder = XLBorderStyleValues.Thin;
            ws.Column(1).Width = 70;
            ws.Column(2).Width = 20;
        }
    }
}
