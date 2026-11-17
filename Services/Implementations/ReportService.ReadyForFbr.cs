using ClosedXML.Excel;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;

namespace MyApp.Api.Services.Implementations;

public partial class ReportService
{
    /// <summary>
    /// Reports > Ready for FBR. The bills <see cref="IsReadyForFbr"/> picks (classified, not yet sent,
    /// not excluded), each as its original lines beside the rows that will be filed: the saved filing
    /// rows, else the rows the filing editor would start from. Same period, client and search rules as
    /// Invoice Sales Detail.
    /// </summary>
    public async Task<ReadyForFbrReportDto> GetReadyForFbrAsync(int companyId, InvoiceSalesDetailQueryDto query)
    {
        var window = InvoiceSalesDetailFilter.ResolveWindow(query);
        var from = window.From!.Value.Date;
        var to = window.To!.Value.Date;
        var search = (query.Search ?? "").Trim();
        var company = await _context.Companies.AsNoTracking().Where(c => c.Id == companyId)
            .Select(c => new { Name = c.BrandName ?? c.Name }).FirstOrDefaultAsync();
        var ready = (await _context.Invoices.AsNoTracking().AsSplitQuery()
                .Include(i => i.Client)
                .Include(i => i.Items).ThenInclude(it => it.ItemType)
                .Include(i => i.Items).ThenInclude(it => it.Adjustment)
                .Where(i => i.CompanyId == companyId && i.Date >= from && i.Date < to.AddDays(1)
                    && i.NoteKind == 0 && !i.IsDemo)
                .OrderBy(i => i.Date).ThenBy(i => i.InvoiceNumber)
                .ToListAsync())
            .Where(IsReadyForFbr).ToList();

        var report = new ReadyForFbrReportDto
        {
            CompanyId = companyId,
            CompanyName = company?.Name ?? "",
            PeriodLabel = window.Label,
            From = from,
            To = to,
            GeneratedAt = DateTime.UtcNow,
            Buyers = ready.GroupBy(i => i.ClientId).Select(g => g.First())
                .Select(i => new InvoiceSalesDetailBuyerDto { ClientId = i.ClientId, Name = i.Client?.Name ?? "", Ntn = i.Client?.NTN ?? "" })
                .OrderBy(b => b.Name, StringComparer.OrdinalIgnoreCase).ToList(),
        };

        var plans = ready.ToDictionary(i => i.Id, i => TaxFilingProjection.Plan(i)?.Rows ?? TaxFilingProjection.InitialRows(i));
        var itemIds = plans.Values.SelectMany(r => r).Select(r => r.ItemTypeId).OfType<int>().Distinct().ToList();
        var itemNames = await _context.ItemTypes.AsNoTracking()
            .Where(t => itemIds.Contains(t.Id) && t.CompanyId == companyId)
            .ToDictionaryAsync(t => t.Id, t => t.Name);

        foreach (var inv in ready.Where(i => query.ClientId == null || i.ClientId == query.ClientId.Value))
        {
            var lines = inv.Items.OrderBy(i => i.Id).ToList();
            var lineNo = lines.Select((l, n) => (l.Id, No: n + 1)).ToDictionary(x => x.Id, x => x.No);
            var rows = plans[inv.Id];
            var taxes = FurtherTaxCalculator.Allocate(inv.GSTAmount, rows.Select(r =>
                string.Equals(r.SaleType, "3rd Schedule Goods", StringComparison.OrdinalIgnoreCase) ? r.RetailPrice ?? 0m : r.ValueExclTax).ToArray());
            var bill = new ReadyForFbrBillDto
            {
                InvoiceId = inv.Id,
                InvoiceNumber = inv.InvoiceNumber.ToString(),
                Date = inv.Date.Date,
                Buyer = inv.Client?.Name ?? "",
                BuyerNtn = inv.Client?.NTN ?? "",
                FbrStatus = string.IsNullOrWhiteSpace(inv.FbrStatus) ? "Ready to validate" : inv.FbrStatus!,
                FbrMessage = inv.FbrStatus == "Failed" ? inv.FbrErrorMessage ?? "" : "",
                TaxRate = inv.GSTRate,
                ExcludingTax = inv.Subtotal,
                SalesTax = inv.GSTAmount,
                FurtherTax = inv.FurtherTaxAmount,
                Total = inv.GrandTotal,
            };
            var rowOfLine = new Dictionary<int, int>();
            for (var n = 0; n < rows.Count; n++)
            {
                var r = rows[n];
                r.SourceLineIds.ForEach(id => rowOfLine[id] = n + 1);
                bill.FilingRows.Add(new ReadyForFbrFilingRowDto
                {
                    RowNumber = n + 1,
                    HsCode = r.HSCode ?? "",
                    Item = r.ItemTypeId is int id && itemNames.TryGetValue(id, out var name) ? name : r.Description,
                    Quantity = r.Quantity,
                    Unit = r.UOM,
                    SaleType = r.SaleType ?? "",
                    ExcludingTax = r.ValueExclTax,
                    SalesTax = taxes[n],
                    SourceLines = r.SourceLineIds.Where(lineNo.ContainsKey).Select(id => lineNo[id]).Order().ToList(),
                });
            }
            bill.OriginalLines = lines.Select(l => new ReadyForFbrOriginalLineDto
            {
                LineNumber = lineNo[l.Id],
                Description = string.IsNullOrWhiteSpace(l.Description) ? l.ItemTypeName : l.Description,
                Quantity = l.Quantity,
                Unit = l.UOM,
                Rate = l.UnitPrice,
                ExcludingTax = l.LineTotal,
                FilingRow = rowOfLine.GetValueOrDefault(l.Id),
            }).ToList();
            if (search.Length > 0 && !Matches(bill, search)) continue;
            report.Bills.Add(bill);
        }

        report.BillCount = report.Bills.Count;
        report.OriginalLineCount = report.Bills.Sum(b => b.OriginalLines.Count);
        report.FilingRowCount = report.Bills.Sum(b => b.FilingRows.Count);
        report.ExcludingTax = report.Bills.Sum(b => b.ExcludingTax);
        report.SalesTax = report.Bills.Sum(b => b.SalesTax);
        report.FurtherTax = report.Bills.Sum(b => b.FurtherTax);
        report.Total = report.Bills.Sum(b => b.Total);
        return report;
    }

    /// <summary>Bill-level search over what the report shows, so a search never splits a bill.</summary>
    private static bool Matches(ReadyForFbrBillDto b, string term)
    {
        bool Has(string? s) => s?.Contains(term, StringComparison.OrdinalIgnoreCase) == true;
        return Has(b.InvoiceNumber) || Has(b.Buyer) || Has(b.BuyerNtn)
            || b.OriginalLines.Any(l => Has(l.Description))
            || b.FilingRows.Any(r => Has(r.HsCode) || Has(r.Item));
    }

    /// <summary>
    /// Every bill to be filed, one row per FILING ROW: the bill's details, then what is filed (HS code,
    /// item, quantity, FBR unit, sale type, value, tax) and the original bill lines that row files. Each
    /// bill ends with its totals.
    /// </summary>
    public async Task<byte[]> GetReadyForFbrExcelAsync(int companyId, InvoiceSalesDetailQueryDto query)
    {
        var report = await GetReadyForFbrAsync(companyId, query);
        string Safe(string? s) => SpreadsheetFormulaGuard.Neutralise(s);
        using var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add("Ready for FBR");
        var headers = new[] { "S. No", "Bill #", "Date", "Buyer", "NTN", "FBR status", "Filed row", "HS Code",
            "Filed item", "Filed qty", "FBR unit", "Sale type", "Excl", "Tax rate", "Sales tax", "Incl",
            "Original bill lines (qty x rate = excl)" };
        const int Cols = 17;

        ws.Cell(1, 1).Value = Safe(report.CompanyName);
        ws.Range(1, 1, 1, Cols).Merge().Style.Font.SetBold().Font.SetFontSize(14);
        ws.Cell(2, 1).Value = $"Ready for FBR · {report.PeriodLabel} · {report.BillCount} bills, {report.FilingRowCount} filing rows · nothing here has been sent to FBR";
        ws.Range(2, 1, 2, Cols).Merge().Style.Font.SetItalic();
        for (var c = 1; c <= Cols; c++) ws.Cell(4, c).Value = headers[c - 1];
        var head = ws.Range(4, 1, 4, Cols);
        head.Style.Font.Bold = true;
        head.Style.Fill.BackgroundColor = XLColor.FromHtml("#DCE8F5");
        ws.SheetView.FreezeRows(4);

        var row = 5;
        var sno = 0;
        foreach (var b in report.Bills)
        {
            var first = row;
            foreach (var f in b.FilingRows)
            {
                ws.Cell(row, 1).Value = ++sno;
                ws.Cell(row, 2).Value = Safe(b.InvoiceNumber);
                ws.Cell(row, 3).Value = b.Date;
                ws.Cell(row, 3).Style.DateFormat.Format = "dd-mm-yyyy";
                ws.Cell(row, 4).Value = Safe(b.Buyer);
                ws.Cell(row, 5).Value = Safe(b.BuyerNtn);
                ws.Cell(row, 6).Value = Safe(b.FbrMessage.Length > 0 ? $"{b.FbrStatus}: {b.FbrMessage}" : b.FbrStatus);
                ws.Cell(row, 7).Value = f.RowNumber;
                ws.Cell(row, 8).Value = Safe(f.HsCode);
                ws.Cell(row, 9).Value = Safe(f.Item);
                ws.Cell(row, 10).Value = f.Quantity;
                ws.Cell(row, 11).Value = Safe(f.Unit);
                ws.Cell(row, 12).Value = Safe(f.SaleType);
                ws.Cell(row, 13).Value = f.ExcludingTax;
                ws.Cell(row, 14).Value = b.TaxRate / 100m;
                ws.Cell(row, 15).Value = f.SalesTax;
                ws.Cell(row, 16).Value = f.ExcludingTax + f.SalesTax;
                ws.Cell(row, 17).Value = Safe(string.Join("\n", b.OriginalLines.Where(l => l.FilingRow == f.RowNumber)
                    .Select(l => $"{l.LineNumber}. {l.Description} — {l.Quantity:0.####} {l.Unit} x {l.Rate:N2} = {l.ExcludingTax:N2}")));
                ws.Cell(row, 14).Style.NumberFormat.Format = "0.00%";
                foreach (var c in new[] { 10, 13, 15, 16 }) ws.Cell(row, c).Style.NumberFormat.Format = "#,##0.00";
                row++;
            }
            ws.Cell(row, 9).Value = $"Bill {Safe(b.InvoiceNumber)} total"
                + (b.FurtherTax != 0m ? $" (further tax {b.FurtherTax:N2}, bill total {b.Total:N2})" : $" (bill total {b.Total:N2})");
            ws.Cell(row, 13).Value = b.FilingRows.Sum(r => r.ExcludingTax);
            ws.Cell(row, 15).Value = b.SalesTax;
            ws.Cell(row, 16).Value = b.FilingRows.Sum(r => r.ExcludingTax) + b.SalesTax;
            foreach (var c in new[] { 13, 15, 16 }) ws.Cell(row, c).Style.NumberFormat.Format = "#,##0.00";
            var sub = ws.Range(row, 1, row, Cols);
            sub.Style.Font.Bold = true;
            sub.Style.Fill.BackgroundColor = XLColor.FromHtml("#F5F7FA");
            ws.Range(first, 1, row, Cols).Style.Border.SetOutsideBorder(XLBorderStyleValues.Thin);
            row++;
        }
        ws.Cell(row, 9).Value = $"Total · {report.BillCount} bills";
        ws.Cell(row, 13).Value = report.Bills.Sum(b => b.FilingRows.Sum(r => r.ExcludingTax));
        ws.Cell(row, 15).Value = report.SalesTax;
        ws.Cell(row, 16).Value = report.Bills.Sum(b => b.FilingRows.Sum(r => r.ExcludingTax)) + report.SalesTax;
        foreach (var c in new[] { 13, 15, 16 }) ws.Cell(row, c).Style.NumberFormat.Format = "#,##0.00";
        ws.Range(row, 1, row, Cols).Style.Font.SetBold().Fill.SetBackgroundColor(XLColor.FromHtml("#EAF2FC"));

        ws.Columns(1, Cols).AdjustToContents(4, Math.Min(row, 300));
        foreach (var c in new[] { 4, 9, 17 })
        {
            ws.Column(c).Width = Math.Min(c == 17 ? 70 : 40, Math.Max(18, ws.Column(c).Width));
            ws.Column(c).Style.Alignment.WrapText = true;
        }
        ws.Range(5, 1, Math.Max(5, row), Cols).Style.Alignment.Vertical = XLAlignmentVerticalValues.Top;
        ws.Range(4, 1, Math.Max(4, row - 1), Cols).SetAutoFilter();
        using var stream = new MemoryStream();
        wb.SaveAs(stream);
        return stream.ToArray();
    }
}
