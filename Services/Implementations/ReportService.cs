using ClosedXML.Excel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Models.Accounting;
using MyApp.Api.Helpers;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// Read-only reporting queries. Every method is company-scoped; the
    /// controller asserts tenant access before calling in.
    /// </summary>
    public class ReportService : IReportService
    {
        private readonly AppDbContext _context;
        private readonly decimal _adjustmentTolerancePkr;

        public ReportService(AppDbContext context, IConfiguration config)
        {
            _context = context;
            // Same key FbrService + InvoiceService use for the dual-book
            // "adjustment out of date" drift gate — so all three agree on when a
            // bill edit invalidates the FBR overlay.
            _adjustmentTolerancePkr = config.GetValue<decimal?>("Invoice:NarrowEditTotalTolerancePkr") ?? 10m;
        }

        public async Task<SalesReportDto> GetSalesReportAsync(int companyId, int? year, int? month, string buyerType,
            DateTime? dateFrom = null, DateTime? dateTo = null, int? clientId = null)
        {
            buyerType = (buyerType ?? "all").Trim().ToLowerInvariant();

            var company = await _context.Companies
                .AsNoTracking()
                .FirstOrDefaultAsync(c => c.Id == companyId);

            // Date window. Half-open [from, toExclusive) so the last day is
            // fully included regardless of any time component on Invoice.Date.
            //   • custom range  → [dateFrom, dateTo]  (both required)
            //   • month + year  → that calendar month
            //   • year only     → the whole calendar year
            var customRange = dateFrom.HasValue && dateTo.HasValue;
            DateTime from, toExclusive;
            string periodLabel;
            if (customRange)
            {
                from = dateFrom!.Value.Date;
                toExclusive = dateTo!.Value.Date.AddDays(1);
                periodLabel = $"{from:dd-MM-yyyy} – {dateTo.Value.Date:dd-MM-yyyy}";
                year = null; month = null;   // not applicable in custom mode
            }
            else
            {
                var y = year ?? DateTime.UtcNow.Year;
                year = y;
                if (month.HasValue)
                {
                    from = new DateTime(y, month.Value, 1);
                    toExclusive = from.AddMonths(1);
                    periodLabel = $"{from:MMMM yyyy}";
                }
                else
                {
                    from = new DateTime(y, 1, 1);
                    toExclusive = from.AddYears(1);
                    periodLabel = $"Year {y}";
                }
            }

            var query = _context.Invoices
                .AsNoTracking()
                .Include(i => i.Client)
                .Include(i => i.Items).ThenInclude(it => it.Adjustment)
                .Where(i => i.CompanyId == companyId
                         && i.Date >= from && i.Date < toExclusive
                         // Only real sale invoices actually submitted to FBR.
                         && i.NoteKind == 0
                         && i.FbrSubmittedAt != null
                         && !i.IsCancelled
                         && !i.IsDemo);

            // Buyer-type filter. Walk-in / counter sales are Unregistered
            // buyers (no NTN). "registered" = has a registered NTN buyer.
            if (buyerType == "registered")
                query = query.Where(i => i.Client != null && i.Client.RegistrationType == "Registered");
            else if (buyerType == "unregistered")
                query = query.Where(i => i.Client == null || i.Client.RegistrationType != "Registered");
            // "all" → no buyer filter.

            // Optional single-client filter (applied on top of the buyer type).
            if (clientId.HasValue)
                query = query.Where(i => i.ClientId == clientId.Value);

            var invoices = await query
                .OrderBy(i => i.Date)
                .ThenBy(i => i.Id)
                .ToListAsync();

            var report = new SalesReportDto
            {
                CompanyId = companyId,
                CompanyName = company?.Name ?? "",
                Year = year,
                Month = month,
                DateFrom = from,
                DateTo = toExclusive.AddDays(-1),
                PeriodLabel = periodLabel,
                BuyerType = buyerType,
            };

            // One group per invoice (document number), ordered by date then id.
            foreach (var inv in invoices)
            {
                var invDto = new SalesReportInvoiceDto
                {
                    InvoiceId = inv.Id,
                    DocumentNumber = inv.InvoiceNumber.ToString(),
                    FbrInvoiceNumber = !string.IsNullOrWhiteSpace(inv.FbrIRN)
                        ? inv.FbrIRN!
                        : (inv.FbrInvoiceNumber ?? ""),
                    DocumentDate = inv.Date.Date,
                    Customer = inv.Client?.Name ?? "",
                };

                int sr = 0;
                foreach (var item in inv.Items.OrderBy(x => x.Id))
                {
                    // Dual-book overlay: show what was FILED to FBR.
                    var a = item.Adjustment;
                    var qty = a?.AdjustedQuantity ?? item.Quantity;
                    var unit = a?.AdjustedUOM ?? item.UOM;
                    var rate = a?.AdjustedUnitPrice ?? item.UnitPrice;
                    var amount = a?.AdjustedLineTotal ?? item.LineTotal;
                    var hs = a?.AdjustedHSCode ?? item.HSCode ?? "";
                    var saleType = a?.AdjustedSaleType ?? item.SaleType;
                    var desc = a?.AdjustedDescription
                               ?? (!string.IsNullOrWhiteSpace(item.Description)
                                    ? item.Description
                                    : item.ItemTypeName);

                    var tax = ComputeLineTax(saleType, amount, item.FixedNotifiedValueOrRetailPrice, inv.GSTRate);

                    invDto.Lines.Add(new SalesReportLineDto
                    {
                        Sr = ++sr,
                        HsCode = hs,
                        Product = desc,
                        Quantity = qty,
                        Unit = unit,
                        Rate = rate,
                        Amount = Round2(amount),
                        DiscountAmount = 0m, // no per-line discount field yet — always 0
                        TaxAmount = tax,
                        TotalAmount = Round2(amount) + tax,
                    });
                }

                invDto.LineCount = invDto.Lines.Count;
                invDto.TotalQuantity = invDto.Lines.Sum(l => l.Quantity);
                invDto.TotalAmount = invDto.Lines.Sum(l => l.Amount);
                invDto.TotalDiscount = invDto.Lines.Sum(l => l.DiscountAmount);
                invDto.TotalTax = invDto.Lines.Sum(l => l.TaxAmount);
                invDto.TotalGross = invDto.Lines.Sum(l => l.TotalAmount);
                report.Invoices.Add(invDto);
            }

            report.GrandQuantity = report.Invoices.Sum(i => i.TotalQuantity);
            report.GrandAmount = report.Invoices.Sum(i => i.TotalAmount);
            report.GrandDiscount = report.Invoices.Sum(i => i.TotalDiscount);
            report.GrandTax = report.Invoices.Sum(i => i.TotalTax);
            report.GrandTotal = report.Invoices.Sum(i => i.TotalGross);
            report.InvoiceCount = report.Invoices.Count;
            report.LineCount = report.Invoices.Sum(i => i.LineCount);

            return report;
        }

        // ── Styled Excel export ──────────────────────────────────────────
        // Grey merged title banner, one bold column-header row (frozen), then
        // per-invoice: a bold summary row with the invoice's totals and its
        // line items grouped beneath as a collapsible outline (+/-), and a
        // merged grand-total row across all invoices. #,##0.00 money columns.
        public async Task<byte[]> GetSalesReportExcelAsync(int companyId, int? year, int? month, string buyerType,
            DateTime? dateFrom = null, DateTime? dateTo = null, int? clientId = null)
        {
            var report = await GetSalesReportAsync(companyId, year, month, buyerType, dateFrom, dateTo, clientId);

            const int COLS = 14; // Sr .. Total Amount (invoice-level cols 1-4/7, line-level 5-6/9-10)
            const string MONEY = "#,##0.00";
            var grey = XLColor.FromHtml("#EBEBEB");
            // Layout carries BOTH invoice-summary and line-detail data, each in
            // its own column so the collapsed (summary-only) view still lines up
            // under the right headers: 1 Sr | 2 Doc No | 3 Date | 4 FBR Inv No |
            // 5 HS Code | 6 Product | 7 Customer | 8 Qty | 9 Unit | 10 Rate |
            // 11 Amount | 12 Dis | 13 Tax | 14 Total.
            var headers = new[] { "Sr.", "Doc. No", "Date", "FBR Inv. No.", "HS Code", "Product", "Customer",
                "Quantity", "Unit", "Rate", "Amount", "Dis Amount", "Tax Amount", "Total Amount" };
            // Right-aligned / money columns (1-based): Quantity, Rate, Amount, Dis, Tax, Total.
            var moneyCols = new[] { 8, 10, 11, 12, 13, 14 };
            var periodLabel = report.PeriodLabel;
            var buyerLabel = report.BuyerType switch
            {
                "registered" => "Registered buyers",
                "unregistered" => "Walk-in / Unregistered buyers",
                _ => "All buyers",
            };

            using var wb = new XLWorkbook();
            var ws = wb.Worksheets.Add("Sale Report");

            // Column widths — wider Product/Customer than the reference since
            // our catalog names run long; money columns kept compact.
            ws.Column(1).Width = 6;    // Sr
            ws.Column(2).Width = 12;   // Doc No
            ws.Column(3).Width = 12;   // Date
            ws.Column(4).Width = 22;   // FBR Inv No
            ws.Column(5).Width = 13;   // HS Code
            ws.Column(6).Width = 34;   // Product
            ws.Column(7).Width = 24;   // Customer
            ws.Column(8).Width = 12;   // Quantity
            ws.Column(9).Width = 10;   // Unit
            for (int c = 10; c <= COLS; c++) ws.Column(c).Width = 14;

            int r = 1;

            // Title banner (merged across all columns, grey fill).
            ws.Cell(r, 1).Value = report.CompanyName;
            var titleRange = ws.Range(r, 1, r, COLS).Merge();
            titleRange.Style.Font.FontSize = 22;
            titleRange.Style.Fill.BackgroundColor = grey;
            titleRange.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            ws.Row(r).Height = 32;
            r++;

            ws.Cell(r, 1).Value = "Sale Report";
            var subTitle = ws.Range(r, 1, r, COLS).Merge();
            subTitle.Style.Font.FontSize = 16;
            subTitle.Style.Fill.BackgroundColor = grey;
            subTitle.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            ws.Row(r).Height = 24;
            r++;

            ws.Cell(r, 1).Value = $"{periodLabel}  ·  {buyerLabel}  ·  FBR-submitted invoices";
            var meta = ws.Range(r, 1, r, COLS).Merge();
            meta.Style.Font.Italic = true;
            meta.Style.Font.FontColor = XLColor.FromHtml("#5F6D7E");
            meta.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            r += 2; // blank spacer row

            // Single column-header row (frozen so it stays visible).
            for (int c = 1; c <= COLS; c++)
            {
                var hc = ws.Cell(r, c);
                hc.Value = headers[c - 1];
                hc.Style.Font.Bold = true;
                hc.Style.Fill.BackgroundColor = grey;
                hc.Style.Border.BottomBorder = XLBorderStyleValues.Thin;
                if (moneyCols.Contains(c)) hc.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
            }
            var headerRow = r;
            r++;

            // Summary rows sit ABOVE their detail rows; group + collapse the
            // detail rows so each invoice can be expanded with the [+] outline
            // button. Summary rows fill the invoice-level columns (Doc No,
            // Date, FBR No, Customer + totals); detail rows fill the line-level
            // columns (HS Code, Product, Unit, Rate + line values). Every value
            // lands under its own header so the collapsed view stays aligned.
            ws.Outline.SummaryVLocation = XLOutlineSummaryVLocation.Top;
            var invFill = XLColor.FromHtml("#F0F7FF");

            int invNo = 0;
            foreach (var inv in report.Invoices)
            {
                invNo++;
                // Invoice summary row.
                ws.Cell(r, 1).Value = invNo;
                ws.Cell(r, 2).Value = inv.DocumentNumber;
                ws.Cell(r, 3).Value = inv.DocumentDate;
                ws.Cell(r, 3).Style.DateFormat.Format = "dd-MM-yyyy";
                ws.Cell(r, 4).Value = inv.FbrInvoiceNumber;
                // Distinct HS codes on the invoice: one if shared, else CSV.
                ws.Cell(r, 5).Value = string.Join(", ",
                    inv.Lines.Select(l => l.HsCode).Where(h => !string.IsNullOrWhiteSpace(h)).Distinct());
                ws.Cell(r, 7).Value = inv.Customer;
                ws.Cell(r, 8).Value = inv.TotalQuantity;
                ws.Cell(r, 11).Value = inv.TotalAmount;
                ws.Cell(r, 12).Value = inv.TotalDiscount;
                ws.Cell(r, 13).Value = inv.TotalTax;
                ws.Cell(r, 14).Value = inv.TotalGross;
                foreach (var c in moneyCols) ws.Cell(r, c).Style.NumberFormat.Format = MONEY;
                var sumRow = ws.Range(r, 1, r, COLS);
                sumRow.Style.Font.Bold = true;
                sumRow.Style.Fill.BackgroundColor = invFill;
                r++;

                // Detail (line-item) rows.
                int firstDetail = r;
                foreach (var l in inv.Lines)
                {
                    ws.Cell(r, 1).Value = l.Sr;
                    ws.Cell(r, 5).Value = l.HsCode;
                    ws.Cell(r, 6).Value = l.Product;
                    ws.Cell(r, 8).Value = l.Quantity;
                    ws.Cell(r, 9).Value = l.Unit;
                    ws.Cell(r, 10).Value = l.Rate;
                    ws.Cell(r, 11).Value = l.Amount;
                    ws.Cell(r, 12).Value = l.DiscountAmount;
                    ws.Cell(r, 13).Value = l.TaxAmount;
                    ws.Cell(r, 14).Value = l.TotalAmount;
                    foreach (var c in moneyCols) ws.Cell(r, c).Style.NumberFormat.Format = MONEY;
                    r++;
                }
                var lastDetail = r - 1;
                if (lastDetail >= firstDetail)
                {
                    ws.Rows(firstDetail, lastDetail).Group();
                    ws.Rows(firstDetail, lastDetail).Collapse();
                }
            }

            r++; // spacer before grand total

            // Grand total across ALL invoices — merged label across Sr..Customer.
            ws.Cell(r, 1).Value = "TOTAL (all invoices):";
            var totalLabel = ws.Range(r, 1, r, 7).Merge();
            totalLabel.Style.Font.Bold = true;
            totalLabel.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
            ws.Cell(r, 8).Value = report.GrandQuantity;
            ws.Cell(r, 11).Value = report.GrandAmount;
            ws.Cell(r, 12).Value = report.GrandDiscount;
            ws.Cell(r, 13).Value = report.GrandTax;
            ws.Cell(r, 14).Value = report.GrandTotal;
            foreach (var c in moneyCols) ws.Cell(r, c).Style.NumberFormat.Format = MONEY;
            var totalRow = ws.Range(r, 1, r, COLS);
            totalRow.Style.Font.Bold = true;
            totalRow.Style.Fill.BackgroundColor = grey;
            totalRow.Style.Border.TopBorder = XLBorderStyleValues.Double;

            ws.SheetView.FreezeRows(headerRow);

            using var ms = new MemoryStream();
            wb.SaveAs(ms);
            return ms.ToArray();
        }

        // ── Tax Sheet — invoice lines still missing a valid HS code ──────
        public async Task<TaxSheetReportDto> GetTaxSheetAsync(int companyId, int? year, int? month,
            DateTime? dateFrom = null, DateTime? dateTo = null, int? clientId = null)
        {
            var company = await _context.Companies.AsNoTracking()
                .FirstOrDefaultAsync(c => c.Id == companyId);

            var customRange = dateFrom.HasValue && dateTo.HasValue;
            DateTime from, toExclusive;
            string periodLabel;
            if (customRange)
            {
                from = dateFrom!.Value.Date;
                toExclusive = dateTo!.Value.Date.AddDays(1);
                periodLabel = $"{from:dd-MM-yyyy} – {dateTo.Value.Date:dd-MM-yyyy}";
                year = null; month = null;
            }
            else
            {
                var y = year ?? DateTime.UtcNow.Year;
                year = y;
                if (month.HasValue) { from = new DateTime(y, month.Value, 1); toExclusive = from.AddMonths(1); periodLabel = $"{from:MMMM yyyy}"; }
                else { from = new DateTime(y, 1, 1); toExclusive = from.AddYears(1); periodLabel = $"Year {y}"; }
            }

            var invoices = await _context.Invoices
                .AsNoTracking()
                .Include(i => i.Client)
                .Include(i => i.Items).ThenInclude(it => it.ItemType)
                .Include(i => i.Items).ThenInclude(it => it.Adjustment)
                .Where(i => i.CompanyId == companyId
                         && i.Date >= from && i.Date < toExclusive
                         && i.NoteKind == 0
                         && !i.IsCancelled
                         && !i.IsDemo
                         // Already filed to FBR → no longer the consultant's
                         // pending work, so it drops off the Tax Sheet. (If the
                         // bill is later edited it re-appears via the
                         // un-classified / out-of-date test below.)
                         && i.FbrSubmittedAt == null
                         // Operator marked this bill "skip / exclude from FBR" — it
                         // will never be filed, so it isn't pending classification.
                         && !i.IsFbrExcluded
                         && (clientId == null || i.ClientId == clientId.Value))
                .OrderBy(i => i.Date).ThenBy(i => i.InvoiceNumber)
                .ToListAsync();

            var report = new TaxSheetReportDto
            {
                CompanyId = companyId,
                CompanyName = company?.Name ?? "",
                Year = year,
                Month = month,
                DateFrom = from,
                DateTo = toExclusive.AddDays(-1),
                PeriodLabel = periodLabel,
            };

            foreach (var inv in invoices)
            {
                // The bill was edited AFTER the consultant reconciled the FBR
                // overlay → the overlay no longer sums to the bill, so the whole
                // invoice needs re-adjustment and every line counts as pending
                // again (mirrors FbrService's Validate/Submit out-of-date gate).
                var outOfDate = IsAdjustmentOutOfDate(inv);

                // Group this invoice's still-pending lines by item-type name,
                // preserving order. A line is pending when it has no EFFECTIVE HS
                // (physical line, dual-book overlay, or item type) OR the whole
                // invoice's overlay is out of date.
                var order = new List<string>();
                var groups = new Dictionary<string, (decimal qty, decimal amount, decimal tax, string uom)>();
                foreach (var item in inv.Items)
                {
                    if (!outOfDate && !string.IsNullOrWhiteSpace(EffectiveHs(item)))
                        continue; // classified + current — not our concern
                    var name = !string.IsNullOrWhiteSpace(item.ItemTypeName) ? item.ItemTypeName
                             : (!string.IsNullOrWhiteSpace(item.ItemType?.Name) ? item.ItemType!.Name : item.Description);
                    if (string.IsNullOrWhiteSpace(name)) name = "(unnamed)";
                    var tax = ComputeLineTax(item.SaleType, item.LineTotal, item.FixedNotifiedValueOrRetailPrice, inv.GSTRate);
                    if (!groups.ContainsKey(name)) { groups[name] = (0m, 0m, 0m, item.UOM ?? ""); order.Add(name); }
                    var g = groups[name];
                    groups[name] = (g.qty + item.Quantity, g.amount + item.LineTotal, g.tax + tax,
                        string.IsNullOrWhiteSpace(g.uom) ? (item.UOM ?? "") : g.uom);
                }
                if (groups.Count == 0) continue; // invoice fully classified + current — skip

                var ntn = inv.Client?.NTN ?? "";
                var party = inv.Client?.Name ?? "";
                foreach (var name in order)
                {
                    var g = groups[name];
                    report.Rows.Add(new TaxSheetRowDto
                    {
                        InvoiceId = inv.Id,
                        ClientId = inv.ClientId,
                        Ntn = ntn,
                        PartyName = party,
                        DocumentNumber = inv.InvoiceNumber.ToString(),
                        DocumentDate = inv.Date.Date,
                        Quantity = g.qty,
                        QuantityLabel = FormatQty(g.qty, g.uom),
                        ItemTypeName = name,
                        ExcludingAmount = Round2(g.amount),
                        SalesTax = g.tax,
                        Total = Round2(g.amount) + g.tax,
                    });
                }
            }

            report.GrandExcluding = report.Rows.Sum(x => x.ExcludingAmount);
            report.GrandTax = report.Rows.Sum(x => x.SalesTax);
            report.GrandTotal = report.Rows.Sum(x => x.Total);
            report.RowCount = report.Rows.Count;
            report.InvoiceCount = report.Rows.Select(x => x.DocumentNumber).Distinct().Count();
            return report;
        }

        public async Task<byte[]> GetTaxSheetExcelAsync(int companyId, int? year, int? month,
            DateTime? dateFrom = null, DateTime? dateTo = null, int? clientId = null)
        {
            var report = await GetTaxSheetAsync(companyId, year, month, dateFrom, dateTo, clientId);

            const int COLS = 9;
            const string MONEY = "#,##0.00";
            var grey = XLColor.FromHtml("#EBEBEB");
            var headers = new[] { "NTN Number", "Party Name", "Inv Number", "Inv Date",
                "Item Total QTY", "HS Code", "Excluding Amount", "Sales Tax", "Total" };
            var moneyCols = new[] { 7, 8, 9 };

            using var wb = new XLWorkbook();
            var ws = wb.Worksheets.Add("Tax Sheet");
            ws.Column(1).Width = 14; ws.Column(2).Width = 28; ws.Column(3).Width = 12;
            ws.Column(4).Width = 13; ws.Column(5).Width = 15; ws.Column(6).Width = 20;
            ws.Column(7).Width = 16; ws.Column(8).Width = 13; ws.Column(9).Width = 15;

            int r = 1;
            ws.Cell(r, 1).Value = report.CompanyName;
            var title = ws.Range(r, 1, r, COLS).Merge();
            title.Style.Font.FontSize = 20; title.Style.Fill.BackgroundColor = grey;
            title.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            ws.Row(r).Height = 28; r++;

            ws.Cell(r, 1).Value = "Tax Sheet — items pending HS code";
            var sub = ws.Range(r, 1, r, COLS).Merge();
            sub.Style.Font.FontSize = 14; sub.Style.Fill.BackgroundColor = grey;
            sub.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center; r++;

            ws.Cell(r, 1).Value = $"{report.PeriodLabel}  ·  {report.InvoiceCount} invoice(s), {report.RowCount} line(s)";
            var meta = ws.Range(r, 1, r, COLS).Merge();
            meta.Style.Font.Italic = true; meta.Style.Font.FontColor = XLColor.FromHtml("#5F6D7E");
            meta.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center; r += 2;

            for (int c = 1; c <= COLS; c++)
            {
                var hc = ws.Cell(r, c);
                hc.Value = headers[c - 1];
                hc.Style.Font.Bold = true;
                hc.Style.Fill.BackgroundColor = grey;
                hc.Style.Border.BottomBorder = XLBorderStyleValues.Thin;
                if (moneyCols.Contains(c)) hc.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
            }
            var headerRow = r; r++;

            foreach (var row in report.Rows)
            {
                ws.Cell(r, 1).Value = row.Ntn;
                ws.Cell(r, 2).Value = row.PartyName;
                ws.Cell(r, 3).Value = row.DocumentNumber;
                ws.Cell(r, 4).Value = row.DocumentDate; ws.Cell(r, 4).Style.DateFormat.Format = "dd-MM-yyyy";
                ws.Cell(r, 5).Value = row.QuantityLabel;
                ws.Cell(r, 6).Value = row.ItemTypeName;
                ws.Cell(r, 7).Value = row.ExcludingAmount;
                ws.Cell(r, 8).Value = row.SalesTax;
                ws.Cell(r, 9).Value = row.Total;
                foreach (var c in moneyCols) ws.Cell(r, c).Style.NumberFormat.Format = MONEY;
                r++;
            }

            ws.Cell(r, 1).Value = "TOTAL:";
            var totalLabel = ws.Range(r, 1, r, 6).Merge();
            totalLabel.Style.Font.Bold = true;
            totalLabel.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
            ws.Cell(r, 7).Value = report.GrandExcluding;
            ws.Cell(r, 8).Value = report.GrandTax;
            ws.Cell(r, 9).Value = report.GrandTotal;
            foreach (var c in moneyCols) ws.Cell(r, c).Style.NumberFormat.Format = MONEY;
            var totalRow = ws.Range(r, 1, r, COLS);
            totalRow.Style.Font.Bold = true;
            totalRow.Style.Fill.BackgroundColor = grey;
            totalRow.Style.Border.TopBorder = XLBorderStyleValues.Double;

            ws.SheetView.FreezeRows(headerRow);

            using var ms = new MemoryStream();
            wb.SaveAs(ms);
            return ms.ToArray();
        }

        public async Task<TaxSheetTransferResultDto> TransferTaxSheetInvoicesAsync(
            int companyId, int? year, int? month, DateTime? dateFrom, DateTime? dateTo,
            int? clientId, DateTime targetDate, string? actorUserName)
        {
            // Resolve the SAME window the tax sheet uses, so we move exactly the
            // set the user is looking at.
            var customRange = dateFrom.HasValue && dateTo.HasValue;
            DateTime from, toExclusive;
            if (customRange) { from = dateFrom!.Value.Date; toExclusive = dateTo!.Value.Date.AddDays(1); }
            else
            {
                var y = year ?? DateTime.UtcNow.Year;
                if (month.HasValue) { from = new DateTime(y, month.Value, 1); toExclusive = from.AddMonths(1); }
                else { from = new DateTime(y, 1, 1); toExclusive = from.AddYears(1); }
            }

            // Tracked query — same predicate as GetTaxSheetAsync.
            var invoices = await _context.Invoices
                .Include(i => i.Items).ThenInclude(it => it.ItemType)
                .Include(i => i.Items).ThenInclude(it => it.Adjustment)
                .Where(i => i.CompanyId == companyId
                         && i.Date >= from && i.Date < toExclusive
                         && i.NoteKind == 0
                         && !i.IsCancelled
                         && !i.IsDemo
                         && i.FbrSubmittedAt == null
                         && !i.IsFbrExcluded
                         && (clientId == null || i.ClientId == clientId.Value))
                .ToListAsync();

            var tDate = targetDate.Date;
            var result = new TaxSheetTransferResultDto { TargetDate = tDate };
            var transferredNumbers = new List<string>();

            foreach (var inv in invoices)
            {
                // Only invoices that still carry an un-classified line are "remaining".
                var hasUnclassified = IsAdjustmentOutOfDate(inv)
                    || inv.Items.Any(item => string.IsNullOrWhiteSpace(EffectiveHs(item)));
                if (!hasUnclassified) continue;

                // A submitted / cancelled invoice can't be re-dated (already filed
                // or voided). Shouldn't reach here — a submitted invoice has HS
                // codes on every line — but guard and report it rather than throw.
                if (inv.FbrStatus == "Submitted" || inv.IsCancelled)
                {
                    result.Skipped++;
                    result.SkippedInvoiceNumbers.Add(inv.InvoiceNumber.ToString());
                    continue;
                }

                if (inv.Date.Date == tDate) continue; // already there

                inv.Date = tDate;
                // A date change invalidates any prior FBR validation.
                inv.FbrStatus = null;
                inv.FbrErrorMessage = null;
                result.Transferred++;
                transferredNumbers.Add(inv.InvoiceNumber.ToString());
            }

            if (result.Transferred > 0)
            {
                await _context.SaveChangesAsync();
                // Audit (best-effort — never break the transfer on a log failure).
                try
                {
                    var moved = string.Join(", ", transferredNumbers.Take(100));
                    var skipped = result.Skipped > 0
                        ? $"; skipped {result.Skipped} submitted/cancelled ({string.Join(", ", result.SkippedInvoiceNumbers.Take(50))})"
                        : "";
                    _context.AuditLogs.Add(new AuditLog
                    {
                        Timestamp = DateTime.UtcNow,
                        Level = "Info",
                        UserName = actorUserName ?? "system",
                        HttpMethod = "POST",
                        RequestPath = $"/reports/company/{companyId}/tax-sheet/transfer",
                        StatusCode = 200,
                        ExceptionType = "TAXSHEET_TRANSFER",
                        Message = $"Tax-sheet transfer: moved {result.Transferred} invoice(s) to {tDate:yyyy-MM-dd} "
                                + $"[{moved}]{skipped}.",
                    });
                    await _context.SaveChangesAsync();
                }
                catch { /* audit is non-critical */ }
            }
            return result;
        }

        // ── Outstanding Ledger — per-client receivables + settling receipts ──
        public async Task<OutstandingLedgerDto> GetOutstandingLedgerAsync(int companyId, int? clientId, string status,
            int? year, int? month, DateTime? dateFrom, DateTime? dateTo)
        {
            status = (status ?? "unpaid").Trim().ToLowerInvariant();
            if (status != "all" && status != "paid") status = "unpaid";

            // Same period model as the Sales report / Tax Sheet: custom range,
            // month+year, or a whole year. Filters on the invoice date.
            var customRange = dateFrom.HasValue && dateTo.HasValue;
            DateTime from, toExclusive;
            string periodLabel;
            if (customRange)
            {
                from = dateFrom!.Value.Date;
                toExclusive = dateTo!.Value.Date.AddDays(1);
                periodLabel = $"{from:dd-MM-yyyy} – {dateTo.Value.Date:dd-MM-yyyy}";
                year = null; month = null;
            }
            else
            {
                var y = year ?? DateTime.UtcNow.Year;
                year = y;
                if (month.HasValue) { from = new DateTime(y, month.Value, 1); toExclusive = from.AddMonths(1); periodLabel = $"{from:MMMM yyyy}"; }
                else { from = new DateTime(y, 1, 1); toExclusive = from.AddYears(1); periodLabel = $"Year {y}"; }
            }

            var company = await _context.Companies.AsNoTracking()
                .FirstOrDefaultAsync(c => c.Id == companyId);

            var q = _context.Invoices.AsNoTracking()
                .Include(i => i.Client)
                .Include(i => i.DeliveryChallans)
                .Where(i => i.CompanyId == companyId && i.NoteKind == 0 && !i.IsCancelled && !i.IsDemo
                         && i.Date >= from && i.Date < toExclusive);
            if (clientId.HasValue) q = q.Where(i => i.ClientId == clientId.Value);

            var invoices = await q.OrderBy(i => i.Date).ThenBy(i => i.InvoiceNumber).ToListAsync();

            // Receipts (money-in) allocated to any of these invoices → the per-row
            // payment detail (cheque # / online ref / amount / date).
            var invIds = invoices.Select(i => i.Id).ToList();
            var allocations = invIds.Count == 0
                ? new List<PaymentAllocation>()
                : await _context.Set<PaymentAllocation>().AsNoTracking()
                    .Include(a => a.Payment)
                    .Where(a => a.InvoiceId != null && invIds.Contains(a.InvoiceId.Value)
                             && a.Payment.Direction == PaymentDirection.Receipt
                             && !a.Payment.IsCancelled)
                    .ToListAsync();
            var payByInvoice = allocations
                .GroupBy(a => a.InvoiceId!.Value)
                .ToDictionary(g => g.Key, g => g.OrderBy(a => a.Payment.Date).ToList());

            var report = new OutstandingLedgerDto
            {
                CompanyId = companyId,
                CompanyName = company?.Name ?? "",
                ClientId = clientId,
                ClientName = clientId.HasValue ? (invoices.FirstOrDefault()?.Client?.Name ?? "") : "",
                StatusFilter = status,
                Year = year,
                Month = month,
                PeriodLabel = periodLabel,
            };

            int sn = 0;
            foreach (var inv in invoices)
            {
                var balance = PaymentStatusCalculator.BalanceDue(inv.GrandTotal, inv.AmountPaid);
                var isPaid = balance <= 0m;
                if (status == "unpaid" && isPaid) continue;
                if (status == "paid" && !isPaid) continue;

                var st = PaymentStatusCalculator.Status(inv.GrandTotal, inv.AmountPaid, inv.DueDate);
                var challans = inv.DeliveryChallans ?? new List<DeliveryChallan>();
                var dc = string.Join("/", challans.Select(c => c.ChallanNumber).Where(n => n > 0).Distinct().OrderBy(n => n));
                DateTime? delivery = challans.Where(c => c.DeliveryDate.HasValue)
                    .Select(c => (DateTime?)c.DeliveryDate!.Value.Date)
                    .OrderBy(d => d).FirstOrDefault();
                // PO lives on the challan(s) for challan-linked bills — derive it
                // from the linked challans (distinct), falling back to the bill's
                // own PoNumber for standalone / no-challan invoices.
                var poFromChallans = string.Join("/", challans
                    .Select(c => c.PoNumber).Where(s => !string.IsNullOrWhiteSpace(s)).Distinct());
                var po = !string.IsNullOrWhiteSpace(poFromChallans) ? poFromChallans : (inv.PoNumber ?? "");

                var row = new OutstandingLedgerRowDto
                {
                    InvoiceId = inv.Id,
                    SerialNo = ++sn,
                    PoNumber = po,
                    DeliveryDate = delivery,
                    InvoiceDate = inv.Date.Date,
                    DcNumbers = dc,
                    BillNumber = inv.InvoiceNumber.ToString(),
                    Amount = Round2(inv.GrandTotal),
                    Paid = Round2(inv.AmountPaid),
                    Balance = Round2(balance),
                    Status = st.ToString(),
                };

                if (payByInvoice.TryGetValue(inv.Id, out var pays))
                {
                    foreach (var a in pays)
                    {
                        var p = a.Payment;
                        var pd = new OutstandingLedgerPaymentDto
                        {
                            Number = $"RCP-{p.Number}",
                            Date = p.Date.Date,
                            Method = p.Method ?? "",
                            ChequeNumber = p.ChequeNumber,
                            ChequeDate = p.ChequeDate?.Date,
                            ChequeStatus = p.ChequeStatus == ChequeStatus.None ? null : p.ChequeStatus.ToString(),
                            Reference = p.BankAccountName,
                            Amount = Round2(a.Amount),
                        };
                        pd.Label = BuildPaymentLabel(pd);
                        row.Payments.Add(pd);
                    }
                    row.PaymentSummary = string.Join("  |  ", row.Payments.Select(x => x.Label));
                }

                report.Rows.Add(row);
            }

            report.GrandAmount = report.Rows.Sum(r => r.Amount);
            report.GrandPaid = report.Rows.Sum(r => r.Paid);
            report.GrandBalance = report.Rows.Sum(r => r.Balance);
            report.InvoiceCount = report.Rows.Count;
            return report;
        }

        private static string BuildPaymentLabel(OutstandingLedgerPaymentDto p)
        {
            var parts = new List<string> { p.Number };
            if (string.Equals(p.Method, "Cheque", StringComparison.OrdinalIgnoreCase))
            {
                var chq = "Cheque" + (string.IsNullOrWhiteSpace(p.ChequeNumber) ? "" : $" #{p.ChequeNumber}");
                if (p.ChequeDate.HasValue) chq += $" ({p.ChequeDate.Value:dd-MMM})";
                if (!string.IsNullOrWhiteSpace(p.ChequeStatus)
                    && !string.Equals(p.ChequeStatus, "Cleared", StringComparison.OrdinalIgnoreCase))
                    chq += $" [{p.ChequeStatus}]";
                parts.Add(chq);
            }
            else
            {
                parts.Add(string.IsNullOrWhiteSpace(p.Method) ? "Payment" : p.Method);
                if (!string.IsNullOrWhiteSpace(p.Reference)) parts.Add(p.Reference!);
            }
            parts.Add($"Rs {p.Amount:#,##0}");
            parts.Add($"on {p.Date:dd-MMM}");
            return string.Join(" · ", parts);
        }

        // ── Styled Excel — mirrors the operator's manual outstanding sheet:
        // company-name banner, bold centered header, per-invoice rows, grand total.
        public async Task<byte[]> GetOutstandingLedgerExcelAsync(int companyId, int? clientId, string status,
            int? year, int? month, DateTime? dateFrom, DateTime? dateTo)
        {
            var report = await GetOutstandingLedgerAsync(companyId, clientId, status, year, month, dateFrom, dateTo);

            const int COLS = 11;
            const string MONEY = "#,##0.00";
            var grey = XLColor.FromHtml("#EBEBEB");
            var headers = new[] { "S.No", "P.O Number", "Delivery Date", "Invoice Receiving Date",
                "D.C #", "Bill #", "Amount Receivable", "Paid", "Balance", "Status", "Payment Details" };
            var moneyCols = new[] { 7, 8, 9 };

            using var wb = new XLWorkbook();
            var ws = wb.Worksheets.Add("Outstanding Ledger");
            double[] widths = { 6, 20, 14, 16, 16, 9, 15, 14, 15, 13, 46 };
            for (int c = 1; c <= COLS; c++) ws.Column(c).Width = widths[c - 1];

            int r = 1;
            ws.Cell(r, 1).Value = report.CompanyName;
            var title = ws.Range(r, 1, r, COLS).Merge();
            title.Style.Font.FontSize = 22; title.Style.Font.Bold = true;
            title.Style.Fill.BackgroundColor = grey;
            title.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            ws.Row(r).Height = 30; r++;

            var statusLabel = report.StatusFilter switch { "paid" => "Paid", "all" => "All invoices", _ => "Outstanding (Unpaid)" };
            ws.Cell(r, 1).Value = $"Outstanding Ledger — {(string.IsNullOrWhiteSpace(report.ClientName) ? "All Clients" : report.ClientName)}";
            var sub = ws.Range(r, 1, r, COLS).Merge();
            sub.Style.Font.FontSize = 14; sub.Style.Font.Bold = true; sub.Style.Fill.BackgroundColor = grey;
            sub.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center; r++;

            ws.Cell(r, 1).Value = $"{report.PeriodLabel}  ·  {statusLabel}  ·  {report.InvoiceCount} invoice(s)";
            var meta = ws.Range(r, 1, r, COLS).Merge();
            meta.Style.Font.Italic = true; meta.Style.Font.FontColor = XLColor.FromHtml("#5F6D7E");
            meta.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center; r += 2;

            for (int c = 1; c <= COLS; c++)
            {
                var hc = ws.Cell(r, c);
                hc.Value = headers[c - 1];
                hc.Style.Font.Bold = true;
                hc.Style.Fill.BackgroundColor = grey;
                hc.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
                hc.Style.Alignment.WrapText = true;
                hc.Style.Border.BottomBorder = XLBorderStyleValues.Thin;
                hc.Style.Border.TopBorder = XLBorderStyleValues.Thin;
            }
            var headerRow = r; r++;

            foreach (var row in report.Rows)
            {
                ws.Cell(r, 1).Value = row.SerialNo;
                ws.Cell(r, 2).Value = row.PoNumber;
                if (row.DeliveryDate.HasValue) { ws.Cell(r, 3).Value = row.DeliveryDate.Value; ws.Cell(r, 3).Style.DateFormat.Format = "dd/mm/yyyy"; }
                ws.Cell(r, 4).Value = row.InvoiceDate; ws.Cell(r, 4).Style.DateFormat.Format = "dd/mm/yyyy";
                ws.Cell(r, 5).Value = row.DcNumbers;
                ws.Cell(r, 6).Value = row.BillNumber;
                ws.Cell(r, 7).Value = row.Amount;
                ws.Cell(r, 8).Value = row.Paid;
                ws.Cell(r, 9).Value = row.Balance;
                ws.Cell(r, 10).Value = row.Status;
                ws.Cell(r, 11).Value = row.PaymentSummary;
                foreach (var c in moneyCols) ws.Cell(r, c).Style.NumberFormat.Format = MONEY;
                ws.Cell(r, 1).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
                ws.Cell(r, 6).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
                ws.Cell(r, 10).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
                ws.Cell(r, 11).Style.Alignment.WrapText = true;
                r++;
            }

            ws.Cell(r, 1).Value = "TOTAL";
            var totalLabel = ws.Range(r, 1, r, 6).Merge();
            totalLabel.Style.Font.Bold = true;
            totalLabel.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
            ws.Cell(r, 7).Value = report.GrandAmount;
            ws.Cell(r, 8).Value = report.GrandPaid;
            ws.Cell(r, 9).Value = report.GrandBalance;
            foreach (var c in moneyCols) ws.Cell(r, c).Style.NumberFormat.Format = MONEY;
            var totalRow = ws.Range(r, 1, r, COLS);
            totalRow.Style.Font.Bold = true;
            totalRow.Style.Fill.BackgroundColor = grey;
            totalRow.Style.Border.TopBorder = XLBorderStyleValues.Double;

            ws.SheetView.FreezeRows(headerRow);

            using var ms = new MemoryStream();
            wb.SaveAs(ms);
            return ms.ToArray();
        }

        // Generic piece-type units we DON'T suffix onto the quantity label
        // (so "60" not "60 Numbers"); real measures like ft / kg / coil stay.
        private static readonly HashSet<string> GenericUnits = new(StringComparer.OrdinalIgnoreCase)
        {
            "pcs", "pc", "piece", "pieces", "nos", "no", "number", "numbers",
            "unit", "units", "each", "ea", "numbers, pieces, units",
        };

        private static string FormatQty(decimal qty, string? uom)
        {
            var n = qty == Math.Truncate(qty) ? qty.ToString("0.##") : qty.ToString("0.####");
            var u = (uom ?? "").Trim();
            return (u.Length > 0 && !GenericUnits.Contains(u)) ? $"{n} {u}" : n;
        }

        // Effective HS for classification purposes: the physical line's own HS,
        // else the dual-book overlay's adjusted HS (what the consultant filed to
        // FBR), else the item type's catalog HS. Empty ⇒ still un-classified.
        private static string? EffectiveHs(InvoiceItem item)
        {
            if (!string.IsNullOrWhiteSpace(item.HSCode)) return item.HSCode;
            if (!string.IsNullOrWhiteSpace(item.Adjustment?.AdjustedHSCode)) return item.Adjustment!.AdjustedHSCode;
            return item.ItemType?.HSCode;
        }

        // True when the delivery bill was edited AFTER the FBR overlay was
        // reconciled, so the overlay no longer sums to the bill total (drift
        // beyond tolerance). Such an invoice needs the consultant to re-adjust,
        // so it belongs back on the Tax Sheet. Only meaningful when at least one
        // line carries an overlay. Mirrors FbrService's out-of-date gate.
        private bool IsAdjustmentOutOfDate(Invoice inv)
        {
            if (inv.Items == null || !inv.Items.Any(ii => ii.Adjustment != null)) return false;
            var billSubtotal = inv.Items.Sum(ii => ii.LineTotal);
            var fbrSubtotal = inv.Items.Sum(ii =>
                ii.Adjustment != null && ii.Adjustment.AdjustedLineTotal.HasValue
                    ? ii.Adjustment.AdjustedLineTotal.Value
                    : ii.LineTotal);
            return Math.Abs(billSubtotal - fbrSubtotal) > _adjustmentTolerancePkr;
        }

        // Per-line sales tax — mirrors FbrService.ComputeFbrTaxes for the two
        // cases that affect the printed tax figure:
        //   • 3rd Schedule Goods → tax = retail(MRP) × rate
        //   • everything else    → tax = amount × rate
        // Further tax (4% unregistered) is a separate FBR field, not part of
        // the "Tax Amount" column on this report, so it's intentionally out.
        private static decimal ComputeLineTax(string? saleType, decimal amount, decimal? retailPrice, decimal gstRate)
        {
            var rate = gstRate / 100m;
            var isThirdSchedule = string.Equals(saleType, "3rd Schedule Goods", StringComparison.OrdinalIgnoreCase);
            var retail = retailPrice ?? 0m;
            if (isThirdSchedule && retail > 0m)
                return Round2(retail * rate);
            return Round2(amount * rate);
        }

        private static decimal Round2(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);
    }
}
