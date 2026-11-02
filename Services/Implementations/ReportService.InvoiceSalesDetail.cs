using ClosedXML.Excel;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;

namespace MyApp.Api.Services.Implementations;

public partial class ReportService
{
        public async Task<InvoiceSalesDetailReportDto> GetInvoiceSalesDetailAsync(int companyId,
            InvoiceSalesDetailQueryDto query)
        {
            var window = InvoiceSalesDetailFilter.ResolveWindow(query);
            var from = window.From!.Value.Date;
            var to = window.To!.Value.Date;
            var until = to.AddDays(1);
            InvoiceSalesDetailFilter.TryParseFbrStatus(query.FbrStatus, out var fbrStatus);
            var search = (query.Search ?? "").Trim();
            var company = await _context.Companies.AsNoTracking()
                .Where(c => c.Id == companyId)
                .Select(c => new { Name = c.BrandName ?? c.Name, c.InvoiceNumberPrefix })
                .FirstOrDefaultAsync();
            var invoiceQuery = _context.Invoices.AsNoTracking().AsSplitQuery()
                .Include(i => i.Client).Include(i => i.Items)
                .Where(i => i.CompanyId == companyId && i.Date >= from && i.Date < until
                    && i.NoteKind == 0 && !i.IsDemo);
            var inPeriod = await invoiceQuery.OrderBy(i => i.Date).ThenBy(i => i.Id).ToListAsync();

            var buyers = inPeriod
                .GroupBy(i => i.ClientId)
                .Select(g => g.First())
                .Select(i => new InvoiceSalesDetailBuyerDto
                {
                    ClientId = i.ClientId, Name = i.Client?.Name ?? "", Ntn = i.Client?.NTN ?? "",
                })
                .OrderBy(b => b.Name, StringComparer.OrdinalIgnoreCase).ThenBy(b => b.ClientId)
                .ToList();

            var invoices = inPeriod
                .Where(i => query.ClientId == null || i.ClientId == query.ClientId.Value)
                .Where(i => fbrStatus == null
                    || IsSubmittedToFbr(i) == (fbrStatus == InvoiceSalesDetailFilter.Submitted))
                .ToList();
            var invoiceIds = invoices.Select(i => i.Id).ToList();
            var challans = await _context.DeliveryChallans.AsNoTracking()
                .Where(c => c.CompanyId == companyId && c.InvoiceId.HasValue
                    && invoiceIds.Contains(c.InvoiceId.Value))
                .Select(c => new { InvoiceId = c.InvoiceId!.Value, c.ChallanNumber })
                .ToListAsync();
            var challansByInvoice = challans.GroupBy(c => c.InvoiceId)
                .ToDictionary(g => g.Key, g => string.Join(", ", g.Select(c => c.ChallanNumber).Distinct().OrderBy(n => n)));

            var report = new InvoiceSalesDetailReportDto
            {
                CompanyId = companyId, CompanyName = company?.Name ?? "", PeriodLabel = window.Label,
                From = from, To = to, GeneratedAt = DateTime.UtcNow, Buyers = buyers,
            };
            var listed = new List<Invoice>();
            foreach (var inv in invoices)
            {
                var rows = new List<InvoiceSalesDetailRowDto>();
                var items = inv.Items.OrderBy(i => i.Id).ToList();
                challansByInvoice.TryGetValue(inv.Id, out var challanNumbers);
                var status = inv.FbrCancelledAt.HasValue ? "FBR cancelled"
                    : BillTaxTreatment.IsOutsideFbr(inv.TaxTreatment) ? inv.TaxTreatment + " · Outside FBR"
                    : inv.IsFbrExcluded ? "Excluded from FBR"
                    : string.IsNullOrWhiteSpace(inv.FbrStatus) ? "Not submitted" : inv.FbrStatus!;
                var fbrNumber = status == "Submitted" ? inv.FbrIRN ?? inv.FbrInvoiceNumber ?? "" : "";
                var billStatus = inv.IsCancelled ? "Cancelled" : "Active";
                var allocatedGst = 0m;

                var taxBases = items.Select(i => ComputeLineTax(i.SaleType, i.LineTotal, i.FixedNotifiedValueOrRetailPrice, inv.GSTRate)).ToList();
                var totalTaxBase = taxBases.Sum();
                for (var index = 0; index < Math.Max(1, items.Count); index++)
                {
                    var item = index < items.Count ? items[index] : null;
                    var amount = item?.LineTotal ?? inv.Subtotal;
                    var tax = item == null ? inv.GSTAmount
                        : index == items.Count - 1 ? inv.GSTAmount - allocatedGst
                        : totalTaxBase > 0m ? Round2(inv.GSTAmount * taxBases[index] / totalTaxBase) : 0m;
                    allocatedGst += tax;
                    var first = index == 0;
                    var freight = first ? inv.FreightCharges : 0m;
                    var further = first ? inv.FurtherTaxAmount : 0m;
                    rows.Add(new InvoiceSalesDetailRowDto
                    {
                        InvoiceId = inv.Id, LineNumber = index + 1, Date = inv.Date.Date,
                        InvoiceNumber = inv.InvoiceNumber.ToString(), InvoiceSeries = company?.InvoiceNumberPrefix ?? "",
                        DeliveryChallanNumbers = string.IsNullOrWhiteSpace(challanNumbers) ? inv.ManualChallanNumber ?? "" : challanNumbers,
                        Buyer = inv.Client?.Name ?? "", BuyerAddress = inv.Client?.Address ?? "",
                        BuyerNtn = inv.Client?.NTN ?? "", HsCode = item?.HSCode ?? "",
                        Description = item == null ? "Imported bill — line detail unavailable"
                            : string.IsNullOrWhiteSpace(item.Description) ? item.ItemTypeName : item.Description,
                        Unit = item?.UOM ?? "", Quantity = item?.Quantity ?? 0m,
                        Rate = item?.UnitPrice ?? 0m, ExcludingTax = amount,
                        TaxRate = inv.GSTRate, SalesTax = tax, IncludingTax = amount + tax,
                        FurtherTax = further,
                        FreightCharges = freight, Total = amount + tax + further + freight,
                        FbrStatus = status, FbrInvoiceNumber = fbrNumber, BillStatus = billStatus,
                    });
                }
                if (search.Length > 0 && !rows.Any(r => InvoiceSalesDetailFilter.RowMatches(r, search)))
                    continue;
                report.Rows.AddRange(rows);
                listed.Add(inv);
            }
            report.InvoiceCount = listed.Count;
            report.SubmittedCount = listed.Count(IsSubmittedToFbr);
            report.NotSubmittedCount = listed.Count(i => !IsSubmittedToFbr(i));
            report.CancelledCount = listed.Count(i => i.IsCancelled);
            report.ExcludingTax = report.Rows.Sum(r => r.ExcludingTax);
            report.SalesTax = report.Rows.Sum(r => r.SalesTax);
            report.FurtherTax = report.Rows.Sum(r => r.FurtherTax);
            report.Total = report.Rows.Sum(r => r.Total);
            return report;
        }

        /// <summary>The one split the report's counts and its FBR status filter share.</summary>
        private static bool IsSubmittedToFbr(Invoice i) =>
            i.FbrStatus == "Submitted" && i.FbrCancelledAt == null;

        public async Task<byte[]> GetInvoiceSalesDetailExcelAsync(int companyId,
            InvoiceSalesDetailQueryDto query)
        {
            var report = await GetInvoiceSalesDetailAsync(companyId, query);
            using var wb = new XLWorkbook();
            var ws = wb.Worksheets.Add("Sales Detail");
            var headers = new[] { "S. No", "Date", "Month", "DC", "DC No", "DC #", "Inv Series",
                "Inv No", "Inv #", "Party Name", "Address", "Ntn", "Hs Code", "Description",
                "Unit", "Qty", "Rate", "Excl", "Tax Rate", "G. S. T", "Incl",
                "Further Tax", "Total", "FBR Status", "FBR Invoice No", "Bill Status" };
            for (var c = 1; c <= headers.Length; c++) ws.Cell(1, c).Value = headers[c - 1];
            var header = ws.Range(1, 1, 1, headers.Length);
            header.Style.Font.Bold = true;
            header.Style.Fill.BackgroundColor = XLColor.FromHtml("#DCE8F5");
            ws.SheetView.FreezeRows(1);
            var row = 2;
            foreach (var d in report.Rows)
            {
                ws.Cell(row, 1).Value = row - 1;
                ws.Cell(row, 2).Value = d.Date;
                ws.Cell(row, 2).Style.DateFormat.Format = "yyyy-mm-dd";
                ws.Cell(row, 3).Value = d.Date.ToString("MMM yyyy");
                ws.Cell(row, 5).Value = SpreadsheetFormulaGuard.Neutralise(d.DeliveryChallanNumbers);
                ws.Cell(row, 6).Value = SpreadsheetFormulaGuard.Neutralise(d.DeliveryChallanNumbers);
                ws.Cell(row, 7).Value = SpreadsheetFormulaGuard.Neutralise(d.InvoiceSeries);
                ws.Cell(row, 8).Value = SpreadsheetFormulaGuard.Neutralise(d.InvoiceNumber);
                ws.Cell(row, 9).Value = SpreadsheetFormulaGuard.Neutralise(d.InvoiceSeries + d.InvoiceNumber);
                ws.Cell(row, 10).Value = SpreadsheetFormulaGuard.Neutralise(d.Buyer);
                ws.Cell(row, 11).Value = SpreadsheetFormulaGuard.Neutralise(d.BuyerAddress);
                ws.Cell(row, 12).Value = SpreadsheetFormulaGuard.Neutralise(d.BuyerNtn);
                ws.Cell(row, 13).Value = SpreadsheetFormulaGuard.Neutralise(d.HsCode);
                ws.Cell(row, 14).Value = SpreadsheetFormulaGuard.Neutralise(d.Description);
                ws.Cell(row, 15).Value = SpreadsheetFormulaGuard.Neutralise(d.Unit);
                ws.Cell(row, 16).Value = d.Quantity;
                ws.Cell(row, 17).Value = d.Rate;
                ws.Cell(row, 18).Value = d.ExcludingTax;
                ws.Cell(row, 19).Value = d.TaxRate / 100m;
                ws.Cell(row, 20).Value = d.SalesTax;
                ws.Cell(row, 21).Value = d.IncludingTax;
                ws.Cell(row, 22).Value = d.FurtherTax;
                ws.Cell(row, 23).Value = d.Total;
                if (d.FreightCharges != 0m)
                    ws.Cell(row, 23).CreateComment().AddText($"Includes freight/cartage: {d.FreightCharges:N2}");
                ws.Cell(row, 24).Value = SpreadsheetFormulaGuard.Neutralise(d.FbrStatus);
                ws.Cell(row, 25).Value = SpreadsheetFormulaGuard.Neutralise(d.FbrInvoiceNumber);
                ws.Cell(row, 26).Value = d.BillStatus;
                ws.Cell(row, 11).Style.Alignment.WrapText = true;
                ws.Cell(row, 14).Style.Alignment.WrapText = true;
                if (d.BuyerAddress.Length > 48 || d.Description.Length > 48)
                    ws.Row(row).Height = 32;
                ws.Cell(row, 19).Style.NumberFormat.Format = "0.00%";
                for (var c = 16; c <= 23; c++)
                    if (c != 19) ws.Cell(row, c).Style.NumberFormat.Format = "#,##0.00";
                row++;
            }
            ws.Cell(row, 14).Value = "Total listed bills";
            ws.Cell(row, 18).Value = report.ExcludingTax;
            ws.Cell(row, 20).Value = report.SalesTax;
            ws.Cell(row, 22).Value = report.FurtherTax;
            ws.Cell(row, 23).Value = report.Total;
            foreach (var c in new[] { 18, 20, 22, 23 })
                ws.Cell(row, c).Style.NumberFormat.Format = "#,##0.00";
            ws.Range(row, 1, row, headers.Length).Style.Font.Bold = true;
            ws.Range(row, 1, row, headers.Length).Style.Fill.BackgroundColor = XLColor.FromHtml("#EAF2FC");
            ws.Columns(1, headers.Length).AdjustToContents(1, Math.Min(row, 200));
            ws.Column(11).Width = Math.Min(55, Math.Max(25, ws.Column(11).Width));
            ws.Column(14).Width = Math.Min(55, Math.Max(25, ws.Column(14).Width));
            ws.Range(1, 1, Math.Max(1, row - 1), headers.Length).SetAutoFilter();
            using var stream = new MemoryStream();
            wb.SaveAs(stream);
            return stream.ToArray();
        }

}
