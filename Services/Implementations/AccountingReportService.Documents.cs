using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models.Accounting;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// Sales and purchase reports — the registers and the "by X" summaries.
    ///
    /// ── Two engines, not twenty reports ──
    /// A register (every invoice / every bill with what is paid and what is left)
    /// and a summary (the same documents grouped by customer, item, item type,
    /// account, date, month or tax). Sales and purchases differ only in which
    /// tables they read, so both sides share one implementation and cannot drift
    /// apart in how they compute tax, paid or outstanding.
    ///
    /// ── Where the figures come from ──
    /// Document totals are read from the documents, not re-derived from lines:
    /// <c>Subtotal</c>, <c>GSTAmount</c>, <c>GrandTotal</c> and <c>AmountPaid</c> are
    /// stored and are what the invoice screens, the aging report and the payment
    /// status all use. Recomputing them from item lines here would produce a report
    /// that disagrees with the document it is reporting on.
    ///
    /// ── Outstanding ──
    /// Always grand total − withholding tax − amount paid, the same expression as
    /// the aging report and the outstanding-documents report. Withholding tax is
    /// deducted at source, so it is never collectible from the customer.
    ///
    /// ── No discount column ──
    /// This product stores no discount field on a document or its lines. A discount
    /// is either a non-inventory line of its own or a settlement adjustment on the
    /// payment, so a Discount column here would be invented rather than reported.
    /// </summary>
    public partial class AccountingReportService
    {
        // ── Register ──────────────────────────────────────────────────────────────

        public async Task<ReportResultDto> GetDocumentRegisterAsync(int companyId,
            ReportFilterDto filter, bool sales)
        {
            var window = ResolveWindow(filter);
            var report = await NewReportAsync(companyId,
                sales ? "Sales Invoice Register" : "Purchase Bill Register",
                window, filter, ledgerSourced: true);
            report.Columns = new List<ReportColumnDto>
            {
                Col("date", "Date", "date"),
                Col("documentNo", sales ? "Invoice No." : "Bill No."),
                Col("party", sales ? "Customer" : "Supplier"),
                Col("subtotal", "Subtotal", "money", totalled: true),
                Col("tax", "Tax", "money", totalled: true),
                Col("withholdingTax", "WHT", "money", totalled: true),
                Col("grandTotal", "Grand Total", "money", totalled: true),
                Col("paid", "Paid", "money", totalled: true),
                Col("outstanding", "Outstanding", "money", totalled: true),
                Col("status", "Status", "status"),
            };

            var today = PakistanClock.Today;
            var rows = await LoadRegisterRowsAsync(companyId, filter, window, sales, today);

            // Newest first: a register is usually opened to find something recent.
            rows = rows.OrderByDescending(r => r.Date).ThenByDescending(r => r.DocumentId).ToList();

            report.TotalCount = rows.Count;
            var (page, size) = ResolvePaging(filter, forExport: false);
            report.Page = page;
            report.PageSize = size;
            report.Rows = rows.Skip((page - 1) * size).Take(size).Cast<object>().ToList();

            report.Totals["subtotal"] = rows.Sum(r => r.Subtotal);
            report.Totals["tax"] = rows.Sum(r => r.Tax);
            report.Totals["withholdingTax"] = rows.Sum(r => r.WithholdingTax);
            report.Totals["grandTotal"] = rows.Sum(r => r.GrandTotal);
            report.Totals["paid"] = rows.Sum(r => r.Paid);
            report.Totals["outstanding"] = rows.Sum(r => r.Outstanding);
            report.Totals["documents"] = rows.Count;

            // Reconcile to the aging report, visibly.
            //
            // A register nets every document, including ones that are OVERPAID and
            // therefore carry a negative outstanding. The aging report counts only
            // documents with something still owing. So the two totals differ by
            // exactly the overpayment — 45,827.48 on Al-Qahera — and two screens
            // showing different "outstanding" figures with no explanation is how
            // people stop trusting reports. Surfacing the overpaid figure as its own
            // total makes the arithmetic add up on the face of the report:
            //     outstanding + overpaid == aging total
            var overpaid = rows.Where(r => r.Outstanding < 0m).Sum(r => -r.Outstanding);
            if (overpaid > 0.005m)
            {
                report.Totals["overpaid"] = overpaid;
                report.TotalLabels["overpaid"] = sales ? "Overpaid by customers" : "Overpaid to suppliers";
                report.Notice = $"{overpaid:N2} of this is overpayment on individual documents, which "
                              + "nets against the outstanding total here but is excluded from the "
                              + $"{(sales ? "Accounts Receivable" : "Accounts Payable")} Aging report. "
                              + "Outstanding plus overpaid equals the aging total.";
            }

            report.TotalLabels["subtotal"] = sales ? "Net Sales" : "Net Purchases";
            report.TotalLabels["tax"] = "Total Tax";
            report.TotalLabels["withholdingTax"] = "Withholding Tax";
            report.TotalLabels["grandTotal"] = sales ? "Total Invoiced" : "Total Billed";
            report.TotalLabels["paid"] = sales ? "Received" : "Paid";
            report.TotalLabels["outstanding"] = "Outstanding";
            report.TotalLabels["documents"] = sales ? "Invoices" : "Bills";

            report.GroupSummaries.Add(new ReportGroupSummaryDto
            {
                Title = "By payment status",
                DrillFilter = "status",
                Rows = rows.GroupBy(r => r.Status)
                    .Select(g => new ReportGroupRowDto
                    {
                        DrillKey = g.Key,
                        Label = g.Key,
                        Amount = g.Sum(x => x.GrandTotal),
                        Count = g.Count(),
                    })
                    .OrderByDescending(g => g.Amount).ToList(),
                Total = rows.Sum(r => r.GrandTotal),
            });

            return report;
        }

        /// <summary>Payment Status is the register asked a narrower question, so it
        /// is the same rows with the status breakdown promoted to the front.</summary>
        private sealed class RegisterRow
        {
            public int DocumentId { get; init; }
            public DateTime Date { get; init; }
            public DateTime? DueDate { get; init; }
            public string DocumentNo { get; init; } = "";
            public string DocumentType { get; init; } = "";
            public int PartyId { get; init; }
            public string Party { get; init; } = "";
            public decimal Subtotal { get; init; }
            public decimal Tax { get; init; }
            public decimal WithholdingTax { get; init; }
            public decimal GrandTotal { get; init; }
            public decimal Paid { get; init; }
            public decimal Outstanding { get; init; }
            public string Status { get; init; } = "";
            public string? Reference { get; init; }
            public string? Division { get; init; }
        }

        private async Task<List<RegisterRow>> LoadRegisterRowsAsync(int companyId,
            ReportFilterDto f, ReportWindow window, bool sales, DateTime today)
        {
            var allowed = f.AllowedDivisionIds;

            if (sales)
            {
                var q = _context.Invoices.AsNoTracking()
                    .Where(i => i.CompanyId == companyId && !i.IsDemo && !i.IsCancelled);
                // Notes have their own report; a register of invoices should not mix
                // them in, or the totals stop meaning "what we sold".
                if (!string.Equals(f.Status, "notes", StringComparison.OrdinalIgnoreCase))
                    q = q.Where(i => i.DocumentType != 9 && i.DocumentType != 10);
                else
                    q = q.Where(i => i.DocumentType == 9 || i.DocumentType == 10);

                if (window.From.HasValue) q = q.Where(i => i.Date >= window.From!.Value);
                if (window.To.HasValue) q = q.Where(i => i.Date <= window.To!.Value);
                if (f.ClientId.HasValue) q = q.Where(i => i.ClientId == f.ClientId!.Value);
                if (f.DivisionId.HasValue) q = q.Where(i => i.DivisionId == f.DivisionId!.Value);
                if (allowed != null)
                    q = q.Where(i => i.DivisionId == null || allowed.Contains(i.DivisionId.Value));
                q = ApplyTaxFilter(q, f, i => i.GSTAmount, i => i.GSTRate);
                if (!string.IsNullOrWhiteSpace(f.Search))
                {
                    var s = f.Search.Trim();
                    q = q.Where(i => EF.Functions.Like(i.Client!.Name, $"%{s}%")
                                  || EF.Functions.Like(i.InvoiceNumber.ToString(), $"%{s}%"));
                }

                var rows = (await q.Select(i => new
                {
                    i.Id, i.InvoiceNumber, i.Date, i.DueDate, i.DocumentType, i.ClientId,
                    Party = i.Client!.Name, i.Subtotal, i.GSTAmount, i.WithholdingTaxAmount,
                    i.GrandTotal, i.AmountPaid, i.PoNumber,
                    Division = i.Division != null ? i.Division.Name : null,
                }).ToListAsync())
                .Select(x => BuildRegisterRow(
                    x.Id, x.Date, x.DueDate,
                    x.DocumentType switch { 10 => $"CN-{x.InvoiceNumber}", 9 => $"DN-{x.InvoiceNumber}", _ => $"INV-{x.InvoiceNumber}" },
                    x.DocumentType switch { 10 => "Credit Note", 9 => "Debit Note", _ => "Sales Invoice" },
                    x.ClientId, x.Party, x.Subtotal, x.GSTAmount, x.WithholdingTaxAmount,
                    x.GrandTotal, x.AmountPaid, x.PoNumber, x.Division, today))
                .ToList();

                return FilterByStatus(rows, f);
            }
            else
            {
                var q = _context.PurchaseBills.AsNoTracking()
                    .Where(b => b.CompanyId == companyId);
                if (window.From.HasValue) q = q.Where(b => b.Date >= window.From!.Value);
                if (window.To.HasValue) q = q.Where(b => b.Date <= window.To!.Value);
                if (f.SupplierId.HasValue) q = q.Where(b => b.SupplierId == f.SupplierId!.Value);
                if (f.DivisionId.HasValue) q = q.Where(b => b.DivisionId == f.DivisionId!.Value);
                if (allowed != null)
                    q = q.Where(b => b.DivisionId == null || allowed.Contains(b.DivisionId.Value));
                q = ApplyTaxFilter(q, f, b => b.GSTAmount, b => b.GSTRate);
                if (!string.IsNullOrWhiteSpace(f.Search))
                {
                    var s = f.Search.Trim();
                    q = q.Where(b => EF.Functions.Like(b.Supplier!.Name, $"%{s}%")
                                  || (b.SupplierBillNumber != null
                                      && EF.Functions.Like(b.SupplierBillNumber, $"%{s}%")));
                }

                var rows = (await q.Select(b => new
                {
                    b.Id, b.PurchaseBillNumber, b.Date, b.DueDate, b.SupplierId,
                    Party = b.Supplier!.Name, b.Subtotal, b.GSTAmount, b.WithholdingTaxAmount,
                    b.GrandTotal, b.AmountPaid, b.SupplierBillNumber,
                    Division = b.Division != null ? b.Division.Name : null,
                }).ToListAsync())
                .Select(x => BuildRegisterRow(
                    x.Id, x.Date, x.DueDate, $"BILL-{x.PurchaseBillNumber}", "Purchase Bill",
                    x.SupplierId, x.Party, x.Subtotal, x.GSTAmount, x.WithholdingTaxAmount,
                    x.GrandTotal, x.AmountPaid, x.SupplierBillNumber, x.Division, today))
                .ToList();

                return FilterByStatus(rows, f);
            }
        }

        private static RegisterRow BuildRegisterRow(int id, DateTime date, DateTime? dueDate,
            string docNo, string docType, int partyId, string party, decimal subtotal,
            decimal tax, decimal wht, decimal grand, decimal paid, string? reference,
            string? division, DateTime today)
        {
            var collectible = WithholdingTaxCalculator.Collectible(grand, wht);
            return new RegisterRow
            {
                DocumentId = id,
                Date = date,
                DueDate = dueDate,
                DocumentNo = docNo,
                DocumentType = docType,
                PartyId = partyId,
                Party = party,
                Subtotal = subtotal,
                Tax = tax,
                WithholdingTax = wht,
                GrandTotal = grand,
                Paid = paid,
                Outstanding = collectible - paid,
                // The same status the invoice and bill lists show, so a register row
                // and the document itself never disagree.
                Status = PaymentStatusCalculator.Status(collectible, paid, dueDate).ToString(),
                Reference = reference,
                Division = division,
            };
        }

        /// <summary>Status is computed after the query (it depends on the due date and
        /// today), so the filter is applied in memory on the narrowed set.</summary>
        private static List<RegisterRow> FilterByStatus(List<RegisterRow> rows, ReportFilterDto f)
        {
            if (string.IsNullOrWhiteSpace(f.Status)) return rows;
            var s = f.Status.Trim();
            if (s.Equals("notes", StringComparison.OrdinalIgnoreCase)) return rows;
            return rows.Where(r => r.Status.Equals(s, StringComparison.OrdinalIgnoreCase)).ToList();
        }

        /// <summary>Shared tax filter for both document sides: taxed / untaxed / a
        /// specific rate.</summary>
        private static IQueryable<T> ApplyTaxFilter<T>(IQueryable<T> q, ReportFilterDto f,
            System.Linq.Expressions.Expression<Func<T, decimal>> taxAmount,
            System.Linq.Expressions.Expression<Func<T, decimal>> taxRate)
        {
            if (string.IsNullOrWhiteSpace(f.Tax)) return q;
            var tax = f.Tax.Trim().ToLowerInvariant();
            if (tax == "taxed")
                return q.Where(BuildCompare(taxAmount, 0m, notEqual: true));
            if (tax == "untaxed")
                return q.Where(BuildCompare(taxAmount, 0m, notEqual: false));
            if (decimal.TryParse(tax, out var rate))
                return q.Where(BuildCompare(taxRate, rate, notEqual: false));
            return q;
        }

        private static System.Linq.Expressions.Expression<Func<T, bool>> BuildCompare<T>(
            System.Linq.Expressions.Expression<Func<T, decimal>> selector, decimal value, bool notEqual)
        {
            var body = notEqual
                ? System.Linq.Expressions.Expression.NotEqual(
                    selector.Body, System.Linq.Expressions.Expression.Constant(value))
                : System.Linq.Expressions.Expression.Equal(
                    selector.Body, System.Linq.Expressions.Expression.Constant(value));
            return System.Linq.Expressions.Expression.Lambda<Func<T, bool>>(body, selector.Parameters);
        }

        // ── "Sales / Purchases by X" ──────────────────────────────────────────────

        public async Task<ReportResultDto> GetDocumentSummaryAsync(int companyId,
            ReportFilterDto filter, bool sales, string groupBy)
        {
            var window = ResolveWindow(filter);
            var key = (groupBy ?? "party").Trim().ToLowerInvariant();
            var report = await NewReportAsync(companyId,
                DocumentSummaryTitle(sales, key), window, filter, ledgerSourced: true);
            report.Columns = new List<ReportColumnDto>
            {
                Col("label", DocumentSummaryDimension(sales, key)),
                Col("amount", sales ? "Net Sales" : "Net Purchases", "money", totalled: true),
                Col("tax", "Tax", "money", totalled: true),
                Col("count", key is "item" or "itemtype" ? "Documents" : "Documents", "int"),
            };

            ReportGroupSummaryDto summary = key switch
            {
                "item" => await DocumentSummaryByItemAsync(companyId, filter, window, sales, byType: false),
                "itemtype" => await DocumentSummaryByItemAsync(companyId, filter, window, sales, byType: true),
                "account" => await DocumentSummaryByAccountAsync(companyId, filter, window, sales),
                "date" => await DocumentSummaryByDateAsync(companyId, filter, window, sales, monthly: false),
                "month" => await DocumentSummaryByDateAsync(companyId, filter, window, sales, monthly: true),
                "tax" => await DocumentSummaryByTaxAsync(companyId, filter, window, sales),
                _ => await DocumentSummaryByPartyAsync(companyId, filter, window, sales),
            };

            report.Rows = summary.Rows.Cast<object>().ToList();
            report.TotalCount = summary.Rows.Count;
            report.Page = 1;
            report.PageSize = summary.Rows.Count;
            report.Totals["amount"] = summary.Total;
            report.Totals["tax"] = summary.Rows.Sum(r => r.Tax);
            report.Totals["documents"] = summary.Rows.Sum(r => r.Count);
            report.TotalLabels["amount"] = sales ? "Net Sales" : "Net Purchases";
            report.TotalLabels["tax"] = "Total Tax";
            report.TotalLabels["documents"] = sales ? "Invoices" : "Bills";
            report.GroupSummaries.Add(summary);
            return report;
        }

        private static string DocumentSummaryTitle(bool sales, string key) => (sales, key) switch
        {
            (true, "item") => "Sales by Item",
            (true, "itemtype") => "Sales by Item Type",
            (true, "account") => "Sales by Account",
            (true, "date") => "Sales by Date",
            (true, "month") => "Monthly Sales",
            (true, "tax") => "Sales by Tax",
            (true, _) => "Sales by Customer",
            (false, "item") => "Purchases by Item",
            (false, "itemtype") => "Purchases by Item Type",
            (false, "account") => "Purchases by Account",
            (false, "date") => "Purchases by Date",
            (false, "month") => "Monthly Purchases",
            (false, "tax") => "Purchases by Tax",
            (false, _) => "Purchases by Supplier",
        };

        private static string DocumentSummaryDimension(bool sales, string key) => key switch
        {
            "item" => "Item",
            "itemtype" => "Item Type",
            "account" => "Account",
            "date" => "Date",
            "month" => "Month",
            "tax" => "Tax Rate",
            _ => sales ? "Customer" : "Supplier",
        };

        /// <summary>
        /// Document-level grouping (party, date, tax) works off the register rows, so
        /// it uses the documents' own stored totals and inherits every filter.
        /// </summary>
        private async Task<ReportGroupSummaryDto> DocumentSummaryByPartyAsync(int companyId,
            ReportFilterDto f, ReportWindow window, bool sales)
        {
            var rows = await LoadRegisterRowsAsync(companyId, f, window, sales, PakistanClock.Today);
            return new ReportGroupSummaryDto
            {
                Title = sales ? "Sales by Customer" : "Purchases by Supplier",
                DrillFilter = sales ? "clientId" : "supplierId",
                Rows = rows.GroupBy(r => new { r.PartyId, r.Party })
                    .Select(g => new ReportGroupRowDto
                    {
                        DrillKey = g.Key.PartyId.ToString(),
                        Label = g.Key.Party,
                        Amount = g.Sum(x => x.Subtotal),
                        Tax = g.Sum(x => x.Tax),
                        Count = g.Count(),
                    })
                    .OrderByDescending(g => g.Amount).ToList(),
                Total = rows.Sum(r => r.Subtotal),
            };
        }

        private async Task<ReportGroupSummaryDto> DocumentSummaryByDateAsync(int companyId,
            ReportFilterDto f, ReportWindow window, bool sales, bool monthly)
        {
            var rows = await LoadRegisterRowsAsync(companyId, f, window, sales, PakistanClock.Today);
            var grouped = monthly
                ? rows.GroupBy(r => new DateTime(r.Date.Year, r.Date.Month, 1))
                : rows.GroupBy(r => r.Date.Date);

            var list = grouped.Select(g => new
            {
                Sort = g.Key,
                Label = monthly ? g.Key.ToString("MMM yyyy") : g.Key.ToString("d MMM yyyy"),
                Amount = g.Sum(x => x.Subtotal),
                Tax = g.Sum(x => x.Tax),
                Count = g.Count(),
            })
            // Chronological: a time series read by size is unreadable.
            .OrderBy(x => x.Sort).ToList();

            return new ReportGroupSummaryDto
            {
                Title = monthly ? (sales ? "Monthly Sales" : "Monthly Purchases")
                                : (sales ? "Sales by Date" : "Purchases by Date"),
                DrillFilter = null,
                Rows = list.Select(x => new ReportGroupRowDto
                {
                    DrillKey = x.Sort.ToString("yyyy-MM-dd"),
                    Label = x.Label, Amount = x.Amount, Tax = x.Tax, Count = x.Count,
                }).ToList(),
                Total = list.Sum(x => x.Amount),
            };
        }

        private async Task<ReportGroupSummaryDto> DocumentSummaryByTaxAsync(int companyId,
            ReportFilterDto f, ReportWindow window, bool sales)
        {
            var rows = await LoadRegisterRowsAsync(companyId, f, window, sales, PakistanClock.Today);
            // Grouped by the EFFECTIVE rate on the document rather than the stored
            // GSTRate, so a document whose rate and amount disagree is grouped by
            // what was actually charged.
            var list = rows.GroupBy(r => r.Subtotal == 0m ? 0m
                                    : Math.Round(r.Tax / r.Subtotal * 100m, 2))
                .Select(g => new ReportGroupRowDto
                {
                    DrillKey = g.Key.ToString("0.##"),
                    Label = g.Key == 0m ? "No tax" : $"{g.Key:0.##}%",
                    Amount = g.Sum(x => x.Subtotal),
                    Tax = g.Sum(x => x.Tax),
                    Count = g.Count(),
                })
                .OrderByDescending(g => g.Amount).ToList();

            return new ReportGroupSummaryDto
            {
                Title = sales ? "Sales by Tax" : "Purchases by Tax",
                DrillFilter = "tax",
                Rows = list,
                Total = list.Sum(r => r.Amount),
            };
        }

        /// <summary>
        /// Item-level grouping, aggregated in SQL over the line tables. Tax is summed
        /// from the DOCUMENTS these lines belong to and is therefore reported at the
        /// group level only — apportioning it per line and re-adding it would drift by
        /// the rounding residual on every document.
        /// </summary>
        private async Task<ReportGroupSummaryDto> DocumentSummaryByItemAsync(int companyId,
            ReportFilterDto f, ReportWindow window, bool sales, bool byType)
        {
            List<ReportGroupRowDto> rows;
            decimal total;

            if (sales)
            {
                var q = BuildInvoiceItemQuery(companyId, f, window);
                var grouped = byType
                    ? await q.GroupBy(it => new { Key = it.ItemTypeId, Name = it.ItemTypeName })
                        .Select(g => new
                        {
                            g.Key.Key, g.Key.Name,
                            Amount = g.Sum(x => x.LineTotal),
                            Qty = g.Sum(x => x.Quantity),
                            Count = g.Select(x => x.InvoiceId).Distinct().Count(),
                        }).ToListAsync()
                    : await q.GroupBy(it => new { Key = (int?)null, Name = it.Description })
                        .Select(g => new
                        {
                            g.Key.Key, g.Key.Name,
                            Amount = g.Sum(x => x.LineTotal),
                            Qty = g.Sum(x => x.Quantity),
                            Count = g.Select(x => x.InvoiceId).Distinct().Count(),
                        }).ToListAsync();

                rows = grouped.Select(g => new ReportGroupRowDto
                {
                    DrillKey = byType ? g.Key?.ToString() : null,
                    Label = string.IsNullOrWhiteSpace(g.Name) ? "Unclassified" : g.Name,
                    Amount = g.Amount,
                    Count = g.Count,
                }).OrderByDescending(r => r.Amount).ToList();
                total = grouped.Sum(g => g.Amount);
            }
            else
            {
                var q = BuildPurchaseItemQuery(companyId, f, window);
                var grouped = byType
                    ? await q.GroupBy(it => new { Key = it.ItemTypeId, Name = it.ItemTypeName })
                        .Select(g => new
                        {
                            g.Key.Key, g.Key.Name,
                            Amount = g.Sum(x => x.LineTotal),
                            Count = g.Select(x => x.PurchaseBillId).Distinct().Count(),
                        }).ToListAsync()
                    : await q.GroupBy(it => new { Key = (int?)null, Name = it.Description })
                        .Select(g => new
                        {
                            g.Key.Key, g.Key.Name,
                            Amount = g.Sum(x => x.LineTotal),
                            Count = g.Select(x => x.PurchaseBillId).Distinct().Count(),
                        }).ToListAsync();

                rows = grouped.Select(g => new ReportGroupRowDto
                {
                    DrillKey = byType ? g.Key?.ToString() : null,
                    Label = string.IsNullOrWhiteSpace(g.Name) ? "Unclassified" : g.Name,
                    Amount = g.Amount,
                    Count = g.Count,
                }).OrderByDescending(r => r.Amount).ToList();
                total = grouped.Sum(g => g.Amount);
            }

            return new ReportGroupSummaryDto
            {
                Title = byType
                    ? (sales ? "Sales by Item Type" : "Purchases by Item Type")
                    : (sales ? "Sales by Item" : "Purchases by Item"),
                DrillFilter = byType ? "itemTypeId" : null,
                Rows = rows,
                Total = total,
            };
        }

        /// <summary>
        /// Grouping by the GL account a line posts to. This is the accounting view of
        /// sales and purchases: which revenue or cost account each line landed on,
        /// resolved the way the posting engine resolves it — the line's own account,
        /// else the item type's, else the company default.
        /// </summary>
        private async Task<ReportGroupSummaryDto> DocumentSummaryByAccountAsync(int companyId,
            ReportFilterDto f, ReportWindow window, bool sales)
        {
            // Read it from the LEDGER rather than re-deriving the account resolution
            // chain: the journal already records exactly which account each document
            // posted to, so this cannot disagree with the P&L.
            var accountType = sales ? AccountType.Income : AccountType.Expense;
            var sourceType = sales ? SourceDocType.Invoice : SourceDocType.PurchaseBill;

            var q = _context.JournalLines.AsNoTracking()
                .Where(l => l.JournalEntry.CompanyId == companyId
                         && l.JournalEntry.SourceDocType == sourceType
                         && l.Account.AccountType == accountType);
            q = ScopeToDivisions(q, f);
            if (window.From.HasValue) q = q.Where(l => l.JournalEntry.Date >= window.From!.Value);
            if (window.To.HasValue) q = q.Where(l => l.JournalEntry.Date <= window.To!.Value);
            if (f.DivisionId.HasValue)
                q = q.Where(l => l.JournalEntry.DivisionId == f.DivisionId!.Value);
            if (sales && f.ClientId.HasValue)
                q = q.Where(l => l.PartyType == "Client" && l.PartyId == f.ClientId!.Value);
            if (!sales && f.SupplierId.HasValue)
                q = q.Where(l => l.PartyType == "Supplier" && l.PartyId == f.SupplierId!.Value);

            var grouped = await q
                .GroupBy(l => new { l.AccountId, Name = l.Account.Name })
                .Select(g => new
                {
                    g.Key.AccountId, g.Key.Name,
                    // Income is credit-natural, cost debit-natural: take the side that
                    // represents the value, so both come out positive.
                    Amount = g.Sum(x => sales ? x.Credit - x.Debit : x.Debit - x.Credit),
                    Count = g.Select(x => x.JournalEntry.SourceDocId).Distinct().Count(),
                })
                .ToListAsync();

            var rows = grouped.Select(g => new ReportGroupRowDto
            {
                DrillKey = g.AccountId.ToString(),
                Label = g.Name,
                Amount = g.Amount,
                Count = g.Count,
            }).OrderByDescending(r => r.Amount).ToList();

            return new ReportGroupSummaryDto
            {
                Title = sales ? "Sales by Account" : "Purchases by Account",
                DrillFilter = "accountId",
                Rows = rows,
                Total = rows.Sum(r => r.Amount),
            };
        }

        private IQueryable<Models.InvoiceItem> BuildInvoiceItemQuery(int companyId,
            ReportFilterDto f, ReportWindow window)
        {
            var q = _context.InvoiceItems.AsNoTracking()
                .Where(it => it.Invoice.CompanyId == companyId
                          && !it.Invoice.IsDemo && !it.Invoice.IsCancelled
                          && it.Invoice.DocumentType != 9 && it.Invoice.DocumentType != 10);
            if (window.From.HasValue) q = q.Where(it => it.Invoice.Date >= window.From!.Value);
            if (window.To.HasValue) q = q.Where(it => it.Invoice.Date <= window.To!.Value);
            if (f.ClientId.HasValue) q = q.Where(it => it.Invoice.ClientId == f.ClientId!.Value);
            if (f.ItemTypeId.HasValue) q = q.Where(it => it.ItemTypeId == f.ItemTypeId!.Value);
            if (f.DivisionId.HasValue) q = q.Where(it => it.Invoice.DivisionId == f.DivisionId!.Value);
            if (f.AllowedDivisionIds != null)
            {
                var allowed = f.AllowedDivisionIds;
                q = q.Where(it => it.Invoice.DivisionId == null
                               || allowed.Contains(it.Invoice.DivisionId.Value));
            }
            if (!string.IsNullOrWhiteSpace(f.Search))
            {
                var s = f.Search.Trim();
                q = q.Where(it => EF.Functions.Like(it.Description, $"%{s}%")
                               || EF.Functions.Like(it.ItemTypeName, $"%{s}%"));
            }
            return q;
        }

        private IQueryable<Models.PurchaseItem> BuildPurchaseItemQuery(int companyId,
            ReportFilterDto f, ReportWindow window)
        {
            var q = _context.PurchaseItems.AsNoTracking()
                .Where(it => it.PurchaseBill.CompanyId == companyId);
            if (window.From.HasValue) q = q.Where(it => it.PurchaseBill.Date >= window.From!.Value);
            if (window.To.HasValue) q = q.Where(it => it.PurchaseBill.Date <= window.To!.Value);
            if (f.SupplierId.HasValue) q = q.Where(it => it.PurchaseBill.SupplierId == f.SupplierId!.Value);
            if (f.ItemTypeId.HasValue) q = q.Where(it => it.ItemTypeId == f.ItemTypeId!.Value);
            if (f.DivisionId.HasValue) q = q.Where(it => it.PurchaseBill.DivisionId == f.DivisionId!.Value);
            if (f.AllowedDivisionIds != null)
            {
                var allowed = f.AllowedDivisionIds;
                q = q.Where(it => it.PurchaseBill.DivisionId == null
                               || allowed.Contains(it.PurchaseBill.DivisionId.Value));
            }
            if (!string.IsNullOrWhiteSpace(f.Search))
            {
                var s = f.Search.Trim();
                q = q.Where(it => EF.Functions.Like(it.Description, $"%{s}%")
                               || EF.Functions.Like(it.ItemTypeName, $"%{s}%"));
            }
            return q;
        }

        // ── Credit / debit notes ──────────────────────────────────────────────────

        /// <summary>
        /// Sales returns and adjustments. Credit notes reduce what a customer owes;
        /// debit notes increase it. Both are sales invoices with a DocumentType, so
        /// this is the register asked for those two types.
        /// </summary>
        public async Task<ReportResultDto> GetNotesReportAsync(int companyId, ReportFilterDto filter)
        {
            var scoped = CloneFilterWithStatus(filter, "notes");
            var report = await GetDocumentRegisterAsync(companyId, scoped, sales: true);
            report.Title = "Credit & Debit Notes";
            report.Columns = report.Columns
                .Where(c => c.Key != "status")
                .Append(Col("documentType", "Type"))
                .ToList();

            report.GroupSummaries.Clear();
            var rows = report.Rows.OfType<RegisterRow>().ToList();
            report.GroupSummaries.Add(new ReportGroupSummaryDto
            {
                Title = "By note type",
                Rows = rows.GroupBy(r => r.DocumentType)
                    .Select(g => new ReportGroupRowDto
                    {
                        Label = g.Key, Amount = g.Sum(x => x.GrandTotal), Count = g.Count(),
                    }).ToList(),
                Total = rows.Sum(r => r.GrandTotal),
            });
            report.TotalLabels["grandTotal"] = "Total Notes";
            return report;
        }

        /// <summary>The filter is bound per request, so overriding Status on a copy
        /// keeps the caller's own filter untouched.</summary>
        private static ReportFilterDto CloneFilterWithStatus(ReportFilterDto f, string status) => new()
        {
            Period = f.Period, From = f.From, To = f.To, DivisionId = f.DivisionId,
            AccountId = f.AccountId, AccountGroupId = f.AccountGroupId,
            PaymentAccountId = f.PaymentAccountId, PayeeType = f.PayeeType, PayeeId = f.PayeeId,
            ClientId = f.ClientId, SupplierId = f.SupplierId, ItemTypeId = f.ItemTypeId,
            Tax = f.Tax, Status = status, Search = f.Search, SortBy = f.SortBy,
            SortDesc = f.SortDesc, GroupBy = f.GroupBy, Page = f.Page, PageSize = f.PageSize,
            AllowedDivisionIds = f.AllowedDivisionIds,
        };
    }
}
