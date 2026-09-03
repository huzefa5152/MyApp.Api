using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// Sales Detail — one row per invoice LINE, with the delivery challan, the
    /// buyer's registration details and every tax the line carries.
    ///
    /// Reproduces the operator's own "Sales Detail" workbook column for column,
    /// including the three reference columns that a spreadsheet needs in order
    /// to build one label by concatenation (prefix / number / combined) — the
    /// report is diffed against that sheet, so the shape is the requirement.
    ///
    /// Nothing here computes its own tax. Sales tax and further tax come from
    /// <see cref="FbrLineTax"/>, the same helper that fills the FBR payload, so
    /// the report and the filing cannot disagree.
    ///
    /// The FBR scenario id is a SUBMIT-time argument and is not stored, so the
    /// end-consumer-retail exemption (SN026/027/028) cannot be evaluated here:
    /// further tax follows the Unregistered + standard-rate rule alone.
    ///
    /// Advance income tax is stored
    /// per INVOICE (it is charged on the invoice total, not per line), so it is
    /// apportioned across the lines by their share of the subtotal with the
    /// remainder landing on the last line — the lines therefore sum to exactly
    /// what the invoice carries.
    /// </summary>
    public partial class AccountingReportService
    {
        public async Task<ReportResultDto> GetSalesDetailAsync(int companyId, ReportFilterDto filter)
        {
            var window = ResolveWindow(filter);
            var report = await NewReportAsync(companyId, "Sales Detail", window, filter,
                ledgerSourced: true);

            report.Columns = new List<ReportColumnDto>
            {
                Col("sNo", "S. No", "int"),
                Col("date", "Date", "date"),
                Col("month", "Month"),
                Col("dcPrefix", "DC"),
                Col("dcNo", "DC No:-", "int"),
                Col("dcRef", "DC #"),
                Col("invPrefix", "R"),
                Col("invNo", "No", "int"),
                Col("invRef", "Inv #"),
                Col("party", "Party Name"),
                Col("address", "Address"),
                Col("ntn", "Ntn"),
                Col("hsCode", "HS CODE"),
                Col("description", "Description"),
                Col("uom", "U"),
                Col("qty", "Qty", "money"),
                Col("rate", "Rate", "money"),
                Col("excl", "Excl", "money", totalled: true),
                Col("taxRate", "Tax Rate"),
                Col("salesTax", "S.Tax", "money", totalled: true),
                Col("incl", "Incl", "money", totalled: true),
                Col("advanceTax", "236-G Tax", "money", totalled: true),
                Col("furtherTax", "Further Tax", "money", totalled: true),
                Col("totalAmt", "Total Amt", "money", totalled: true),
            };

            // Sale documents only: Credit (10) and Debit (9) Notes have their own
            // report, and a cancelled or sandbox row is not a sale.
            //
            // The ledger import writes TWO kinds of document, told apart by their
            // ExternalRef (see CustomerLedgerImportService.Commit):
            //   "ledger-inv:<company>:<ref>"   an imported SALE  -> belongs here
            //   "ledger-open:<company>:<row>"  a customer's OPENING BALANCE
            // An opening balance is a figure brought forward from the old books,
            // not something that was sold, so it is excluded. Including it added
            // 78,377,977.30 of brought-forward balances to this company's sales
            // and put 49 rows with no reference at the top of the register.
            var invoices = _context.Invoices.AsNoTracking()
                .Where(inv => inv.CompanyId == companyId
                           && !inv.IsDemo && !inv.IsCancelled
                           && inv.DocumentType != 9 && inv.DocumentType != 10
                           && (inv.ExternalRef == null
                               || !inv.ExternalRef.StartsWith("ledger-open:")));

            if (window.From.HasValue) invoices = invoices.Where(inv => inv.Date >= window.From!.Value);
            if (window.To.HasValue) invoices = invoices.Where(inv => inv.Date <= window.To!.Value);

            var clientId = filter.ClientId ?? filter.PayeeId;
            if (clientId.HasValue) invoices = invoices.Where(inv => inv.ClientId == clientId.Value);
            if (filter.DivisionId.HasValue)
                invoices = invoices.Where(inv => inv.DivisionId == filter.DivisionId!.Value);

            // Division RBAC. [BindNever] on the filter, set by the controller only.
            if (filter.AllowedDivisionIds != null)
            {
                var allowed = filter.AllowedDivisionIds;
                invoices = invoices.Where(inv => inv.DivisionId == null
                                              || allowed.Contains(inv.DivisionId.Value));
            }

            // LEFT JOIN, not an inner one: a document brought in by the ledger
            // import records a total and carries NO line items, and this company's
            // history is mostly those. An inner join over InvoiceItems returned a
            // register with one row in it. Such a document contributes a single
            // row whose line columns are blank and whose money is the document's
            // own -- honest about what the import actually knows.
            var q = invoices.SelectMany(
                inv => inv.Items.DefaultIfEmpty(),
                (inv, it) => new { Inv = inv, It = it });

            if (filter.ItemTypeId.HasValue)
                q = q.Where(x => x.It != null && x.It.ItemTypeId == filter.ItemTypeId!.Value);

            if (!string.IsNullOrWhiteSpace(filter.Search))
            {
                var s = filter.Search.Trim();
                q = q.Where(x => (x.It != null && EF.Functions.Like(x.It.Description, $"%{s}%"))
                              || (x.It != null && EF.Functions.Like(x.It.HSCode ?? "", $"%{s}%"))
                              || EF.Functions.Like(x.Inv.Client!.Name, $"%{s}%")
                              || EF.Functions.Like(x.Inv.Client!.NTN ?? "", $"%{s}%")
                              || EF.Functions.Like(x.Inv.ExternalRef ?? "", $"%{s}%"));
            }

            report.TotalCount = await q.CountAsync();
            var (page, size) = ResolvePaging(filter, forExport: false);
            report.Page = page;
            report.PageSize = size;

            // Oldest first, and stable within an invoice: this is a register the
            // operator reads down the page, and the S. No column has to mean
            // something across pages.
            var lines = await q
                .OrderBy(x => x.Inv.Date)
                .ThenBy(x => x.Inv.Id)
                .ThenBy(x => x.It == null ? 0 : x.It.Id)
                .Skip((page - 1) * size).Take(size)
                .Select(x => new
                {
                    InvoiceId = x.Inv.Id,
                    Description = x.It == null ? null : x.It.Description,
                    HSCode = x.It == null ? null : x.It.HSCode,
                    UOM = x.It == null ? null : x.It.UOM,
                    Quantity = x.It == null ? (decimal?)null : x.It.Quantity,
                    UnitPrice = x.It == null ? (decimal?)null : x.It.UnitPrice,
                    // A document with no lines states its own subtotal, so its
                    // money columns are the document's rather than blank.
                    LineTotal = x.It == null ? x.Inv.Subtotal : x.It.LineTotal,
                    SaleType = x.It == null ? null : x.It.SaleType,
                    Retail = x.It == null ? null : x.It.FixedNotifiedValueOrRetailPrice,
                    Inv = new
                    {
                        x.Inv.Date,
                        x.Inv.InvoiceNumber,
                        x.Inv.IsMigrated,
                        x.Inv.ExternalRef,
                        x.Inv.GSTRate,
                        x.Inv.Subtotal,
                        x.Inv.GSTAmount,
                        x.Inv.AdvanceTaxAmount,
                        Party = x.Inv.Client!.Name,
                        Address = x.Inv.Client!.Address,
                        Ntn = x.Inv.Client!.NTN,
                        RegType = x.Inv.Client!.RegistrationType,
                        Challan = x.Inv.DeliveryChallans
                            .Where(dc => dc.Status != "Cancelled")
                            .OrderBy(dc => dc.ChallanNumber)
                            .Select(dc => (int?)dc.ChallanNumber)
                            .FirstOrDefault(),
                    },
                    HasLine = x.It != null,
                })
                .ToListAsync();

            // Advance tax is per INVOICE, so apportion it across that invoice's
            // lines. Only the lines ON THIS PAGE are in hand, so the share is
            // taken against the invoice's stored subtotal rather than the page's
            // sum — a line's share is the same figure whichever page it lands on.
            var rows = new List<object>(lines.Count);
            var runningNo = (page - 1) * size;

            foreach (var l in lines)
            {
                runningNo++;

                // A real InvoiceItem is needed for the shared tax helper, so the
                // report cannot drift from the FBR payload. A line-less document
                // has no sale type to classify, so its tax is the document's own
                // recorded GSTAmount rather than a rule applied to nothing.
                decimal salesTax, furtherTax;
                if (l.HasLine)
                {
                    var forTax = new MyApp.Api.Models.InvoiceItem
                    {
                        LineTotal = l.LineTotal,
                        SaleType = l.SaleType,
                        FixedNotifiedValueOrRetailPrice = l.Retail,
                    };
                    (salesTax, furtherTax, _) = FbrLineTax.Compute(
                        forTax, l.Inv.GSTRate, l.Inv.RegType ?? "", scenarioId: null);
                }
                else
                {
                    salesTax = l.Inv.GSTAmount;
                    furtherTax = 0m;
                }

                var advance = l.Inv.AdvanceTaxAmount != 0m && l.Inv.Subtotal != 0m
                    ? Math.Round(l.Inv.AdvanceTaxAmount * (l.LineTotal / l.Inv.Subtotal), 2,
                                 MidpointRounding.AwayFromZero)
                    : 0m;

                var incl = l.LineTotal + salesTax;
                var (dcPrefix, dcNo, dcRef) = SplitReference(
                    l.Inv.Challan.HasValue ? $"DC-{l.Inv.Challan.Value}" : null);
                var (invPrefix, invNo, invRef) = SplitReference(
                    MigratedReferenceOf(l.Inv.IsMigrated, l.Inv.ExternalRef)
                        ?? l.Inv.InvoiceNumber.ToString());

                rows.Add(new
                {
                    sNo = runningNo,
                    date = l.Inv.Date,
                    month = l.Inv.Date.ToString("MMM yyyy"),
                    dcPrefix,
                    dcNo,
                    dcRef,
                    invPrefix,
                    invNo,
                    invRef,
                    party = l.Inv.Party,
                    address = l.Inv.Address,
                    ntn = l.Inv.Ntn,
                    hsCode = l.HSCode,
                    description = l.Description,
                    uom = l.UOM,
                    qty = l.Quantity,
                    rate = l.UnitPrice,
                    excl = l.LineTotal,
                    // The operator's sheet states the rate as a FRACTION (0.18),
                    // so the column is text rather than a money format.
                    taxRate = (l.Inv.GSTRate / 100m).ToString("0.####"),
                    salesTax,
                    incl,
                    advanceTax = advance,
                    furtherTax,
                    totalAmt = incl + advance + furtherTax,
                    // Drill-down keys, not columns.
                    invoiceId = l.InvoiceId,
                });
            }

            report.Rows = rows;

            // Totals span the WHOLE result set, not the page — a register's
            // footer that only added up one page would be worse than none.
            //
            // Sales tax, further tax and advance tax cannot be summed in SQL:
            // each depends on the per-row rules above. Walk the whole set once
            // for the footer, projecting only the few fields those rules need.
            var forTotals = await q
                .Select(x => new
                {
                    LineTotal = x.It == null ? x.Inv.Subtotal : x.It.LineTotal,
                    SaleType = x.It == null ? null : x.It.SaleType,
                    Retail = x.It == null ? null : x.It.FixedNotifiedValueOrRetailPrice,
                    x.Inv.GSTRate,
                    x.Inv.Subtotal,
                    x.Inv.GSTAmount,
                    x.Inv.AdvanceTaxAmount,
                    RegType = x.Inv.Client!.RegistrationType,
                    HasLine = x.It != null,
                })
                .ToListAsync();

            decimal excl = 0m, totalTax = 0m, totalFurther = 0m, totalAdvance = 0m;
            foreach (var t in forTotals)
            {
                excl += t.LineTotal;
                if (t.HasLine)
                {
                    var (st, ft, _) = FbrLineTax.Compute(
                        new MyApp.Api.Models.InvoiceItem
                        {
                            LineTotal = t.LineTotal,
                            SaleType = t.SaleType,
                            FixedNotifiedValueOrRetailPrice = t.Retail,
                        },
                        t.GSTRate, t.RegType ?? "", scenarioId: null);
                    totalTax += st;
                    totalFurther += ft;
                }
                else
                {
                    totalTax += t.GSTAmount;
                }
                if (t.AdvanceTaxAmount != 0m && t.Subtotal != 0m)
                    totalAdvance += Math.Round(
                        t.AdvanceTaxAmount * (t.LineTotal / t.Subtotal), 2,
                        MidpointRounding.AwayFromZero);
            }
            report.Totals["excl"] = excl;
            report.Totals["salesTax"] = totalTax;
            report.Totals["incl"] = excl + totalTax;
            report.Totals["advanceTax"] = totalAdvance;
            report.Totals["furtherTax"] = totalFurther;
            report.Totals["totalAmt"] = excl + totalTax + totalAdvance + totalFurther;
            report.Totals["transactionCount"] = forTotals.Count;
            report.TotalLabels["excl"] = "Excluding Tax";
            report.TotalLabels["salesTax"] = "Sales Tax";
            report.TotalLabels["incl"] = "Including Tax";
            report.TotalLabels["advanceTax"] = "236-G Tax";
            report.TotalLabels["furtherTax"] = "Further Tax";
            report.TotalLabels["totalAmt"] = "Total Amount";
            report.TotalLabels["transactionCount"] = "Lines";

            return report;
        }

        /// <summary>
        /// "AA-1" -> ("AA-", 1, "AA-1"); "7" -> ("", 7, "7"); null -> ("", null, "").
        ///
        /// The operator's workbook keeps the prefix, the number and the combined
        /// label in three columns so Excel can rebuild the label, and compares
        /// this report against it column for column.
        /// </summary>
        private static (string Prefix, int? Number, string Reference) SplitReference(string? reference)
        {
            if (string.IsNullOrWhiteSpace(reference)) return ("", null, "");
            var r = reference.Trim();
            var i = r.Length;
            while (i > 0 && char.IsDigit(r[i - 1])) i--;
            if (i == r.Length) return (r, null, r);          // no trailing digits
            var digits = r[i..];
            return (r[..i], int.TryParse(digits, out var n) ? n : null, r);
        }

        /// <summary>
        /// The reference an imported document had in the books it came from:
        /// "ledger-inv:451:AA-1" -> "AA-1". Null for a document this system
        /// raised, which uses its own invoice number instead.
        /// </summary>
        private static string? MigratedReferenceOf(bool isMigrated, string? externalRef)
            => isMigrated && !string.IsNullOrWhiteSpace(externalRef)
                ? externalRef.Split(':').Last()
                : null;
    }
}
