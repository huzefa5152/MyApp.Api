using ClosedXML.Excel;
using MyApp.Api.DTOs;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Annex-H1 of the monthly sales tax return (SRO 55(I)/2025): the stock
    /// statement commercial importers, distributors and wholesalers file, one
    /// row per HS code x unit x sales tax rate, Opening / Purchased-imported /
    /// Supplies / Closing in quantity and value, all AT COST.
    ///
    /// Built ONLY from the monthly GD sheet's lines (<see cref="StockMonthlySheet"/>),
    /// so H1 cannot disagree with the sheet, the stock screen or the ledger:
    /// "cost" is the stock value excluding tax (maintainer's decision,
    /// 2026-10-03), the same figure all three report.
    ///
    ///  • Opening = the line's position on the 1st (what was there before the
    ///    month), Purchased = what ARRIVED during the month (GD arrivals,
    ///    purchases, other stock in), Supplies = what SALES took (net of sale
    ///    returns), split taxable (rate above 0) and exempt (0%).
    ///  • H1 has no column for a stock ADJUSTMENT, a revaluation or a
    ///    restatement, but they move stock, so they are shown in an "Other"
    ///    column the consultant can account for; Closing is still the walk's own
    ///    month-end figure, never a subtraction.
    ///  • H1 carries no GD columns: the GD detail stays on the monthly sheet.
    /// </summary>
    public static class AnnexH1
    {
        public sealed class Row
        {
            public string HsCode { get; init; } = "";
            public string Unit { get; init; } = "";
            public decimal Rate { get; init; }          // percent
            public decimal OpeningQty, OpeningValue;
            public decimal PurchasedQty, PurchasedValue;
            public decimal TaxableQty, TaxableValue;
            public decimal ExemptQty, ExemptValue;
            public decimal OtherQty, OtherValue;        // out (+) / in (-) outside sales
            public decimal ClosingQty, ClosingValue;
            public int Lines;
        }

        /// <summary>Normalise an HS code to its 8-digit tariff form "NNNN.NNNN"
        /// (FBR's spelling), so "8423.9000:-" and "84239000" are one row.</summary>
        public static string NormaliseHs(string? hs)
        {
            var digits = new string((hs ?? "").Where(char.IsDigit).ToArray());
            if (digits.Length >= 8) return $"{digits[..4]}.{digits[4..8]}";
            if (digits.Length > 4) return $"{digits[..4]}.{digits[4..].PadRight(4, '0')}";
            return digits.Length > 0 ? digits : "(no HS code)";
        }

        public static List<Row> Build(IEnumerable<StockMonthlyLineDto> lines)
        {
            var rows = new Dictionary<(string, string, decimal), Row>();
            foreach (var l in lines)
            {
                var key = (NormaliseHs(l.HsCode), (l.Unit ?? "").Trim(), Math.Round(l.SalesTaxRate, 2));
                if (!rows.TryGetValue(key, out var r))
                    rows[key] = r = new Row { HsCode = key.Item1, Unit = key.Item2, Rate = key.Item3 };
                r.Lines++;
                r.OpeningQty += l.OpeningQuantity - l.ReceivedQuantity;
                r.OpeningValue += l.OpeningValueExcludingTax - l.ReceivedValueExcludingTax;
                r.PurchasedQty += l.ReceivedQuantity;
                r.PurchasedValue += l.ReceivedValueExcludingTax;
                if (key.Item3 > 0m) { r.TaxableQty += l.SoldQuantity; r.TaxableValue += l.SoldValueExcludingTax; }
                else { r.ExemptQty += l.SoldQuantity; r.ExemptValue += l.SoldValueExcludingTax; }
                r.ClosingQty += l.BalanceQuantity;
                r.ClosingValue += l.BalanceValueExcludingTax;
            }
            foreach (var r in rows.Values)
            {
                // Everything that moved stock outside a sale: adjustments,
                // revaluations, restatements. Derived so the row always closes.
                r.OtherQty = r.OpeningQty + r.PurchasedQty - r.TaxableQty - r.ExemptQty - r.ClosingQty;
                r.OtherValue = r.OpeningValue + r.PurchasedValue - r.TaxableValue - r.ExemptValue - r.ClosingValue;
            }
            return rows.Values
                .Where(r => r.Lines > 0 && !(Nil(r.OpeningQty) && Nil(r.PurchasedQty) && Nil(r.TaxableQty)
                                            && Nil(r.ExemptQty) && Nil(r.ClosingQty) && Math.Abs(r.ClosingValue) < 0.005m
                                            && Math.Abs(r.OtherValue) < 0.005m))
                .OrderBy(r => r.HsCode, StringComparer.Ordinal).ThenBy(r => r.Unit).ThenBy(r => r.Rate)
                .ToList();
        }

        private static bool Nil(decimal q) => Math.Abs(q) < 0.00005m;

        private static readonly string[] Headers =
        {
            "Sr.", "HS Code", "Unit of Measure", "Sales Tax Rate",
            "Opening Qty", "Opening Value",
            "Purchased / Imported Qty", "Purchased / Imported Value",
            "Domestic Taxable Supplies Qty", "Domestic Taxable Supplies Value",
            "Exempt Supplies Qty", "Exempt Supplies Value",
            "Other (adjustments) Qty", "Other (adjustments) Value",
            "Closing Qty", "Closing Value",
        };

        public static byte[] BuildWorkbook(string companyName, DateTime month, IList<Row> rows, IEnumerable<string> notes)
        {
            using var wb = new XLWorkbook();
            var ws = wb.Worksheets.Add("Annex-H1");
            var monthName = month.ToString("MMM yyyy", System.Globalization.CultureInfo.InvariantCulture);
            ws.Cell(1, 1).Value = ExcelTemplateEngine.CsvSafe(companyName);
            ws.Cell(1, 1).Style.Font.SetBold().Font.SetFontSize(13);
            ws.Cell(2, 1).Value = $"Annex-H1 (Stock) -- {monthName} -- values at cost, excluding sales tax";
            ws.Cell(2, 1).Style.Font.SetItalic();

            const int head = 4;
            for (var c = 0; c < Headers.Length; c++)
            {
                var cell = ws.Cell(head, c + 1);
                cell.Value = Headers[c];
                cell.Style.Font.SetBold().Alignment.SetWrapText(true);
                cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#DDEBF7");
                cell.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
            }
            ws.Row(head).Height = 45;

            const string qty = "#,##0.####";
            const string money = "#,##0.00";
            var r = head + 1;
            var sr = 1;
            foreach (var row in rows)
            {
                ws.Cell(r, 1).Value = sr++;
                ws.Cell(r, 2).Value = row.HsCode;
                ws.Cell(r, 3).Value = ExcelTemplateEngine.CsvSafe(row.Unit);
                ws.Cell(r, 4).Value = row.Rate / 100m; ws.Cell(r, 4).Style.NumberFormat.Format = "0.##%";
                var figures = new[]
                {
                    (row.OpeningQty, qty), (Math.Round(row.OpeningValue, 2), money),
                    (row.PurchasedQty, qty), (Math.Round(row.PurchasedValue, 2), money),
                    (row.TaxableQty, qty), (Math.Round(row.TaxableValue, 2), money),
                    (row.ExemptQty, qty), (Math.Round(row.ExemptValue, 2), money),
                    (row.OtherQty, qty), (Math.Round(row.OtherValue, 2), money),
                    (row.ClosingQty, qty), (Math.Round(row.ClosingValue, 2), money),
                };
                for (var i = 0; i < figures.Length; i++)
                {
                    ws.Cell(r, 5 + i).Value = figures[i].Item1;
                    ws.Cell(r, 5 + i).Style.NumberFormat.Format = figures[i].Item2;
                }
                r++;
            }
            var last = r - 1;
            ws.Cell(r, 2).Value = "Total";
            ws.Cell(r, 2).Style.Font.SetBold();
            if (last > head)
                for (var c = 5; c <= 16; c++)
                {
                    var letter = ws.Column(c).ColumnLetter();
                    ws.Cell(r, c).FormulaA1 = $"SUM({letter}{head + 1}:{letter}{last})";
                    ws.Cell(r, c).Style.NumberFormat.Format = c % 2 == 1 ? qty : money;
                    ws.Cell(r, c).Style.Font.SetBold();
                }

            ws.Column(1).Width = 5; ws.Column(2).Width = 13; ws.Column(3).Width = 24; ws.Column(4).Width = 9;
            for (var c = 5; c <= 16; c++) ws.Column(c).Width = 15;
            ws.SheetView.FreezeRows(head);

            var n = wb.Worksheets.Add("Notes");
            var nr = 1;
            foreach (var line in new[]
            {
                "Rows are HS code x unit x sales tax rate, as Annex-H1 asks. GD detail is on the monthly stock sheet.",
                "Values are at cost: the stock value excluding sales tax -- the same figure as the stock screen and the ledger.",
                "Opening = held on the 1st. Purchased / Imported = arrived during the month (GD arrivals, purchases, other stock in).",
                "Supplies = what sales took, net of sale returns; 0% lines are reported as exempt.",
                "Other = stock adjustments, revaluations and restatements, which Annex-H1 has no column for. Review them before filing.",
                "Units are the item's selling unit. A GD declared in another unit (e.g. kg) must be converted before filing.",
            }.Concat(notes))
            {
                n.Cell(nr++, 1).Value = ExcelTemplateEngine.CsvSafe(line);
            }
            n.Column(1).Width = 120;

            using var ms = new MemoryStream();
            wb.SaveAs(ms);
            return ms.ToArray();
        }
    }
}
