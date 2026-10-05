using ClosedXML.Excel;
using MyApp.Api.DTOs;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Workbooks for the importer's tax desk (2026-10-05): the GD register and
    /// the monthly input-tax worksheet. Each carries its figures as VALUES
    /// computed on the server -- the same numbers the screen shows -- and every
    /// operator string goes through <see cref="ExcelTemplateEngine.CsvSafe"/>.
    /// </summary>
    public static class ImportTaxExcel
    {
        private const string Money = "#,##0.00;[Red]-#,##0.00";
        private const string Qty = "#,##0.####";
        private const string Rate = "0.##\"%\"";

        public static byte[] Register(GdRegisterDto reg)
        {
            using var wb = new XLWorkbook();
            var ws = wb.Worksheets.Add("GD Register");
            var heads = new[]
            {
                "GD Number", "Collectorate", "Type", "GD Date", "Claim Month", "Claim By", "Claim status",
                "Description", "Item", "HS Code", "Qty", "Unit", "Assessed Value", "Customs Duty", "ACD", "RD",
                "ST Rate", "Sales Tax", "AST Rate", "Value Added Tax", "GST/FED", "IT Rate", "Income Tax",
                "Landed Cost", "Input Tax", "Selling Value", "Source",
            };
            for (int c = 0; c < heads.Length; c++) ws.Cell(1, c + 1).Value = heads[c];
            Header(ws.Range(1, 1, 1, heads.Length));
            var r = 2;
            foreach (var l in reg.Lines)
            {
                int c = 1;
                ws.Cell(r, c++).Value = ExcelTemplateEngine.CsvSafe(l.GdNumber);
                ws.Cell(r, c++).Value = ExcelTemplateEngine.CsvSafe(l.CollectorateName ?? l.Collectorate ?? "");
                ws.Cell(r, c++).Value = ExcelTemplateEngine.CsvSafe(l.GdTypeName ?? l.GdType ?? "");
                DateCell(ws.Cell(r, c++), l.GdDate, "dd-mm-yyyy");
                DateCell(ws.Cell(r, c++), l.ClaimMonth, "mmm yyyy");
                DateCell(ws.Cell(r, c++), l.ClaimBy, "mmm yyyy");
                ws.Cell(r, c++).Value = StatusText(l.ClaimStatus);
                ws.Cell(r, c++).Value = ExcelTemplateEngine.CsvSafe(l.Description);
                ws.Cell(r, c++).Value = ExcelTemplateEngine.CsvSafe(l.ItemName ?? "");
                ws.Cell(r, c++).Value = ExcelTemplateEngine.CsvSafe(l.HsCode ?? "");
                Num(ws.Cell(r, c++), l.Quantity, Qty);
                ws.Cell(r, c++).Value = ExcelTemplateEngine.CsvSafe(l.Unit ?? "");
                var costed = l.Source == "gd-costing";
                foreach (var (v, fmt) in new[]
                {
                    (l.AssessedValue, Money), (l.CustomsDuty, Money), (l.Acd, Money), (l.RegulatoryDuty, Money),
                    (l.SalesTaxRate, Rate), (l.SalesTax, Money), (l.AstRate, Rate), (l.ValueAddedTax, Money),
                    (l.OtherTax, Money), (l.IncomeTaxRate, Rate), (l.IncomeTax, Money), (l.LandedCost, Money),
                    (l.InputTax, Money),
                })
                {
                    // A stock-sheet GD carries no duty or tax figures: blank, not zero.
                    if (costed || fmt == Rate) Num(ws.Cell(r, c), v, fmt);
                    c++;
                }
                Num(ws.Cell(r, c++), l.SellingValue, Money);
                ws.Cell(r, c++).Value = costed ? "GD costing" : "Stock sheet";
                r++;
            }
            ws.Cell(r, 1).Value = "Total";
            ws.Cell(r, 1).Style.Font.Bold = true;
            foreach (var col in new[] { 13, 14, 15, 16, 18, 20, 21, 23, 24, 25, 26 })
            {
                ws.Cell(r, col).FormulaA1 = r > 2 ? $"SUM({ws.Cell(2, col).Address}:{ws.Cell(r - 1, col).Address})" : "0";
                ws.Cell(r, col).Style.NumberFormat.Format = Money;
                ws.Cell(r, col).Style.Font.Bold = true;
            }
            ws.SheetView.FreezeRows(1);
            ws.Range(1, 1, Math.Max(1, r - 1), heads.Length).SetAutoFilter();
            ws.Columns().AdjustToContents(1, Math.Min(r, 200), 8, 48);

            var s = wb.Worksheets.Add("Summary");
            var rows = new List<(string, object)>
            {
                ("Company", ExcelTemplateEngine.CsvSafe(reg.CompanyName)),
                ("GDs listed", reg.GdCount),
                ("From", reg.From?.ToString("MMM yyyy") ?? "the first GD"),
                ("To", reg.To?.ToString("MMM yyyy") ?? "the last GD"),
                ("Unclaimed only", reg.UnclaimedOnly ? "Yes" : "No"),
                ("Assessed value", reg.TotalAssessedValue), ("Customs duty + ACD + RD", reg.TotalDuties),
                ("Sales tax at import", reg.TotalSalesTax), ("Value added tax at import", reg.TotalValueAddedTax),
                ("Income tax at import", reg.TotalIncomeTax), ("Landed cost", reg.TotalLandedCost),
                ("Input tax", reg.TotalInputTax), ("Input tax not yet claimed", reg.UnclaimedInputTax),
                ("Claim window", $"{reg.ClaimPeriods} tax periods after the GD's month"),
                ("Note", "Stock-sheet GDs carry no duty or tax figures; import their GD costing sheet to fill them."),
            };
            SummaryRows(s, rows);
            using var ms = new MemoryStream();
            wb.SaveAs(ms);
            return ms.ToArray();
        }

        public static byte[] Worksheet(InputTaxWorksheetDto w)
        {
            using var wb = new XLWorkbook();
            var ws = wb.Worksheets.Add("Input Tax");
            var heads = new[]
            {
                "Month", "Output tax", "Import sales tax", "Import value added tax", "Import GST/FED",
                "Purchase input tax", "Input this month", "Brought forward", "Available",
                $"Cap ({w.CapPercent:0.##}% of output)", "Admissible", "Carried forward", "Payable", "Cap applied",
            };
            for (int c = 0; c < heads.Length; c++) ws.Cell(1, c + 1).Value = heads[c];
            Header(ws.Range(1, 1, 1, heads.Length));
            var r = 2;
            foreach (var m in w.Months)
            {
                DateCell(ws.Cell(r, 1), m.Month, "mmm yyyy");
                var vals = new[]
                {
                    m.OutputTax, m.ImportSalesTax, m.ImportValueAddedTax, m.ImportOtherTax, m.PurchaseInputTax,
                    m.InputThisMonth, m.BroughtForward, m.Available, m.CapLimit, m.Admissible, m.CarriedForward, m.Payable,
                };
                for (int i = 0; i < vals.Length; i++) Num(ws.Cell(r, i + 2), vals[i], Money);
                ws.Cell(r, 14).Value = m.CapApplied ? "Yes" : "";
                r++;
            }
            ws.SheetView.FreezeRows(1);
            ws.Columns().AdjustToContents(1, Math.Max(2, r), 10, 30);

            var t = wb.Worksheets.Add("Claim time limit");
            var th = new[] { "Status", "GD Number", "GD Date", "Claim Month", "Claim By", "Description", "HS Code", "Input Tax" };
            for (int c = 0; c < th.Length; c++) t.Cell(1, c + 1).Value = th[c];
            Header(t.Range(1, 1, 1, th.Length));
            r = 2;
            foreach (var l in w.TimeLimit)
            {
                t.Cell(r, 1).Value = StatusText(l.Status);
                t.Cell(r, 2).Value = ExcelTemplateEngine.CsvSafe(l.GdNumber);
                DateCell(t.Cell(r, 3), l.GdDate, "dd-mm-yyyy");
                DateCell(t.Cell(r, 4), l.ClaimMonth, "mmm yyyy");
                DateCell(t.Cell(r, 5), l.ClaimBy, "mmm yyyy");
                t.Cell(r, 6).Value = ExcelTemplateEngine.CsvSafe(l.Description);
                t.Cell(r, 7).Value = ExcelTemplateEngine.CsvSafe(l.HsCode ?? "");
                Num(t.Cell(r, 8), l.InputTax, Money);
                r++;
            }
            t.SheetView.FreezeRows(1);
            t.Columns().AdjustToContents(1, Math.Max(2, r), 8, 48);

            SummaryRows(wb.Worksheets.Add("Summary"), new List<(string, object)>
            {
                ("Company", ExcelTemplateEngine.CsvSafe(w.CompanyName)),
                ("Months", $"{w.From:MMM yyyy} to {w.To:MMM yyyy}"),
                ("Section 8B cap", $"{w.CapPercent:0.##}% of the month's output tax"),
                ("Claim window", $"{w.ClaimPeriods} tax periods after the GD's month"),
                ("Input tax lapsed (not claimed in time)", w.LapsedInputTax),
                ("Input tax still open to claim", w.OpenInputTax),
                ("Note", "A worksheet from the documents, by claim month. Your consultant files the return; "
                         + "input tax carried forward from imports is adjusted against later output tax, not refunded."),
            });
            using var ms = new MemoryStream();
            wb.SaveAs(ms);
            return ms.ToArray();
        }

        private static string StatusText(string s) => s switch
        {
            "claimed" => "Claimed",
            "open" => "Not claimed yet",
            "lapsed" => "Lapsed",
            "claimed-late" => "Claimed after the window",
            _ => "",
        };

        private static void Header(IXLRange r)
        {
            r.Style.Font.Bold = true;
            r.Style.Fill.BackgroundColor = XLColor.FromHtml("#DCE6F1");
            r.Style.Alignment.WrapText = true;
        }

        private static void Num(IXLCell c, decimal v, string fmt)
        {
            c.Value = v;
            c.Style.NumberFormat.Format = fmt;
        }

        private static void DateCell(IXLCell c, DateTime? d, string fmt)
        {
            if (d is not DateTime v) return;
            c.Value = v;
            c.Style.DateFormat.Format = fmt;
        }

        private static void SummaryRows(IXLWorksheet s, List<(string Label, object Value)> rows)
        {
            var r = 1;
            foreach (var (label, value) in rows)
            {
                s.Cell(r, 1).Value = label;
                s.Cell(r, 1).Style.Font.Bold = true;
                if (value is decimal d) Num(s.Cell(r, 2), d, Money);
                else if (value is int i) s.Cell(r, 2).Value = i;
                else s.Cell(r, 2).Value = value?.ToString() ?? "";
                r++;
            }
            s.Column(1).Width = 40;
            s.Column(2).Width = 60;
            s.Column(2).Style.Alignment.WrapText = true;
        }
    }
}
