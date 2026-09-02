using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers.ExcelImport;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// Turning ledger rows into documents, and proving the result agrees with
    /// the workbook before any of it is written.
    /// </summary>
    public partial class CustomerLedgerImportService
    {
        // ── Rows to documents ────────────────────────────────────────────────

        private void BuildDocuments(
            List<IndexEntry> index, CustomerLedgerMapping map, CustomerLedgerPreviewDto preview)
        {
            var unreferenced = 0;

            foreach (var entry in index)
            {
                var client = new LedgerClientPreviewDto
                {
                    IndexRow = entry.Row,
                    IndexName = entry.Name,
                    SheetName = entry.Sheet != null && !SameName(entry.Sheet.Name, entry.Name) ? entry.Sheet.Name : null,
                    SheetTab = entry.Sheet?.Tab,
                    MatchKind = entry.MatchKind,
                    Opening = Money(entry.Opening),
                    StatedClosing = entry.StatedClosing,
                };

                if (entry.MatchKind == LedgerClientMatch.Fuzzy)
                    client.Warnings.Add(
                        $"Paired with the sheet \"{entry.Sheet?.Tab}\" by name similarity — confirm this is the same customer.");

                // A positive opening is money owed, so it is an invoice. A
                // NEGATIVE opening is a customer in credit; a negative invoice
                // would corrupt totals and print, so it becomes a receipt.
                if (entry.Opening > 0m)
                {
                    preview.Invoices.Add(new LedgerInvoiceDto
                    {
                        IndexRow = entry.Row,
                        Reference = "Opening",
                        InvoiceNumber = map.OpeningBand + entry.Row,
                        Date = map.OpeningDate,
                        Amount = Money(entry.Opening),
                        IsOpening = true,
                    });
                    client.InvoiceCount++;
                }
                else if (entry.Opening < 0m)
                {
                    preview.Receipts.Add(new LedgerReceiptDto
                    {
                        IndexRow = entry.Row,
                        SourceRow = 0,
                        Date = map.OpeningDate,
                        Amount = Money(-entry.Opening),
                        Method = "Cash",
                        Description = "Opening advance",
                        IsOpening = true,
                    });
                    client.ReceiptCount++;
                    client.Warnings.Add(
                        "Opening balance is negative — this customer had paid ahead, so it is recorded as money received, not an invoice.");
                }

                if (entry.Sheet != null)
                    BuildFromSheet(entry, client, map, preview, ref unreferenced);

                client.ComputedClosing = client.Opening + client.TotalCredit - client.TotalDebit;
                client.Difference = client.ComputedClosing - client.StatedClosing;

                if (entry.HasStatedClosing && Math.Abs(client.Difference) > ToleranceFor(client))
                    client.Warnings.Add(
                        $"Computed closing {client.ComputedClosing:N2} does not match the index's {client.StatedClosing:N2}.");

                preview.Clients.Add(client);
            }

            preview.ClientsOutOfBalance = preview.Clients.Count(c => Math.Abs(c.Difference) > ToleranceFor(c));
            if (preview.ClientsOutOfBalance > 0)
                preview.BlockingErrors.Add(
                    $"{preview.ClientsOutOfBalance} customer(s) do not reconcile against the index sheet. Fix the workbook and upload again — importing a wrong opening balance follows that customer through every statement afterwards.");

            var fuzzy = preview.Clients.Count(c => c.MatchKind == LedgerClientMatch.Fuzzy);
            if (fuzzy > 0)
                preview.Warnings.Add(
                    $"{fuzzy} customer sheet(s) were paired by name similarity. Check each before importing.");
        }

        private void BuildFromSheet(
            IndexEntry entry, LedgerClientPreviewDto client, CustomerLedgerMapping map,
            CustomerLedgerPreviewDto preview, ref int unreferenced)
        {
            var sheet = entry.Sheet!;
            DateTime? carried = null;

            // Credit rows sharing a reference are ONE invoice written across
            // several lines, so they are grouped before anything else.
            var invoiceRows = new Dictionary<string, LedgerInvoiceDto>(StringComparer.OrdinalIgnoreCase);
            var outOfPeriod = 0;

            foreach (var row in sheet.Rows)
            {
                var date = row.Date ?? (map.UndatedRule == CustomerLedgerMapping.UsePeriodEnd
                    ? map.PeriodEnd
                    : carried ?? map.OpeningDate);

                if (row.Date.HasValue) carried = row.Date;
                else client.UndatedRowCount++;

                if (map.PeriodStart != default && (date < map.PeriodStart || date > map.PeriodEnd))
                    outOfPeriod++;

                var invoiceAmount = map.CreditIsInvoice ? row.Credit : row.Debit;
                var receiptAmount = map.CreditIsInvoice ? row.Debit : row.Credit;

                if (invoiceAmount != 0m)
                {
                    var key = row.Reference ?? $"__row{row.Row}";
                    if (invoiceRows.TryGetValue(key, out var existing))
                    {
                        existing.Amount += invoiceAmount;
                        existing.SourceRows.Add(row.Row);
                    }
                    else
                    {
                        var number = CustomerLedgerMapping.NumberFromRef(row.Reference);
                        if (number == null) number = map.UnreferencedBand + (++unreferenced);

                        invoiceRows[key] = new LedgerInvoiceDto
                        {
                            IndexRow = entry.Row,
                            Reference = row.Reference,
                            InvoiceNumber = number.Value,
                            Date = date,
                            Amount = invoiceAmount,
                            SourceRows = new List<int> { row.Row },
                        };
                    }
                }

                if (receiptAmount != 0m)
                {
                    var (method, description) = ReadMethod(row.Narrative);
                    var stored = Money(receiptAmount);
                    preview.Receipts.Add(new LedgerReceiptDto
                    {
                        IndexRow = entry.Row,
                        SourceRow = row.Row,
                        Date = date,
                        Amount = stored,
                        Method = method,
                        Description = description,
                    });
                    client.TotalDebit += stored;
                    client.ReceiptCount++;
                }
            }

            foreach (var inv in invoiceRows.Values)
            {
                // Round the DOCUMENT, not each contributing row: a reference
                // written across several lines is stored as ONE invoice, so the
                // single rounding belongs on its total.
                inv.Amount = Money(inv.Amount);
                preview.Invoices.Add(inv);
                client.TotalCredit += inv.Amount;
                client.InvoiceCount++;
                if (inv.SourceRows.Count > 1)
                    client.Warnings.Add(
                        $"Reference {inv.Reference} appears on {inv.SourceRows.Count} rows — treated as one invoice of {inv.Amount:N2}.");
            }

            if (client.UndatedRowCount > 0)
                client.Warnings.Add(
                    $"{client.UndatedRowCount} row(s) had no date; the date of the row above was used.");

            if (outOfPeriod > 0)
                client.Warnings.Add($"{outOfPeriod} row(s) are dated outside the period.");

            // The running-balance column is hand-maintained and drifts. Reported
            // so the operator knows the workbook disagrees with itself, but the
            // ROWS are what gets imported — they are the reliable half.
            var fromRows = client.Opening + client.TotalCredit - client.TotalDebit;
            if (sheet.LastStatedBalance.HasValue
                && Math.Abs(sheet.LastStatedBalance.Value - fromRows) > ToleranceFor(client))
            {
                client.Warnings.Add(
                    $"The sheet's own running Balance column ends at {sheet.LastStatedBalance.Value:N2}, which does not match its rows. The rows are used.");
            }
        }

        /// <summary>
        /// Reads the payment method out of a row's narrative. The vocabulary is
        /// small and stable across these workbooks: cash, a transfer, a cheque,
        /// or a bank's own reference such as "BAH # 11841307".
        /// </summary>
        private static (string Method, string? Description) ReadMethod(string? narrative)
        {
            var text = (narrative ?? "").Trim();
            if (text.Length == 0) return ("Cash", null);

            var lower = text.ToLowerInvariant();

            if (lower.Contains("cheq") || lower.Contains("cheque"))
                return ("Cheque", text);
            if (lower.Contains("transfer"))
                return ("Bank Transfer", text);
            if (BankReference.IsMatch(text))
                return ("Bank Transfer", text);
            if (lower.Contains("cash"))
                return ("Cash", null);

            return ("Cash", text);
        }

        /// <summary>A bank's own slip reference — "BAH # 11841307", "JS #69873895".</summary>
        private static readonly Regex BankReference =
            new(@"^[A-Za-z]{2,6}\s*#", RegexOptions.Compiled);

        /// <summary>
        /// Amounts are stored as decimal(18,2) — PKR is 2dp. Rounding HERE, at
        /// preview time, is what makes the reconciliation honest: the operator
        /// sees the closing balance the system will actually hold, not one
        /// computed at a precision it cannot keep.
        /// </summary>
        private static decimal Money(decimal value) =>
            Math.Round(value, 2, MidpointRounding.AwayFromZero);

        /// <summary>
        /// How far a customer's computed closing may sit from the index's stated
        /// figure. The workbook carries many decimal places and the system keeps
        /// two, so every stored document can differ by up to half a paisa and
        /// those differences accumulate down a long ledger. One paisa per
        /// document keeps a 36-document customer inside tolerance, while a real
        /// error — which is rupees, not paisa — still fails.
        /// </summary>
        private static decimal ToleranceFor(LedgerClientPreviewDto client) =>
            BalanceTolerance + 0.01m * (client.InvoiceCount + client.ReceiptCount);

        private static bool SameName(string? a, string? b) =>
            string.Equals((a ?? "").Trim(), (b ?? "").Trim(), StringComparison.OrdinalIgnoreCase);

        // ── Existing clients and document numbers ────────────────────────────

        /// <summary>
        /// Matches each imported customer against clients this company already
        /// has, so a second import updates rather than creating a duplicate
        /// customer record beside the first.
        /// </summary>
        private async Task ResolveExistingClientsAsync(CustomerLedgerPreviewDto preview, int companyId)
        {
            var existing = await _db.Clients.AsNoTracking()
                .Where(c => c.CompanyId == companyId)
                .Select(c => new { c.Id, c.Name })
                .ToListAsync();
            if (existing.Count == 0) return;

            var byKey = new Dictionary<string, (int Id, string Name)>();
            foreach (var c in existing)
            {
                var key = Normalise(c.Name);
                if (!byKey.ContainsKey(key)) byKey[key] = (c.Id, c.Name);
            }

            foreach (var client in preview.Clients)
            {
                if (byKey.TryGetValue(Normalise(client.IndexName), out var hit)
                    || (client.SheetName != null && byKey.TryGetValue(Normalise(client.SheetName), out hit)))
                {
                    client.ClientId = hit.Id;
                    client.ExistingClientName = hit.Name;
                }
            }
        }

        /// <summary>
        /// Invoice numbers are integers unique per company, so a clash is not a
        /// cosmetic problem — one of the two documents cannot be written. Two
        /// sources of clash are checked: the same number used by two different
        /// customers in this file, and a number the company already uses.
        /// </summary>
        private async Task CheckNumberCollisionsAsync(CustomerLedgerPreviewDto preview, int companyId)
        {
            var duplicates = preview.Invoices
                .GroupBy(i => i.InvoiceNumber)
                .Where(g => g.Select(x => x.IndexRow).Distinct().Count() > 1)
                .Take(10)
                .ToList();

            foreach (var dup in duplicates)
            {
                var names = dup.Select(d => preview.Clients.FirstOrDefault(c => c.IndexRow == d.IndexRow)?.IndexName ?? "?")
                    .Distinct();
                preview.BlockingErrors.Add(
                    $"Invoice number {dup.Key} is used by more than one customer ({string.Join(", ", names)}). Give them distinct references in the workbook.");
            }

            // The workbook's reference numbers are NOT used as invoice numbers
            // any more -- imported documents are numbered from the reserved band
            // (MigratedDocumentNumbers) and keep their reference on ExternalRef.
            // So a company already holding invoice 51 no longer conflicts with a
            // sheet that mentions AA-51, and re-importing a workbook no longer
            // collides with the documents its own previous run created.
            //
            // What still has to be checked is whether THIS company already holds
            // the same imported references, because that would double the
            // customer's balance rather than update it.
            var refs = preview.Invoices
                .Where(i => !i.IsOpening && !string.IsNullOrWhiteSpace(i.Reference))
                .Select(i => $"ledger-inv:{companyId}:{i.Reference}")
                .Distinct()
                .ToList();
            if (refs.Count == 0) return;

            var already = await _db.Invoices.AsNoTracking()
                .Where(i => i.CompanyId == companyId && i.ExternalRef != null && refs.Contains(i.ExternalRef))
                .Select(i => i.ExternalRef!)
                .Distinct()
                .ToListAsync();

            if (already.Count > 0)
            {
                var shown = already.Take(5).Select(r => r.Split(':').Last());
                preview.BlockingErrors.Add(
                    $"{already.Count} of these documents are already imported into this company "
                  + $"(for example {string.Join(", ", shown)}). Importing again would double those "
                  + "balances — remove the earlier import first, or import into a different company.");
            }
        }
    }

}
