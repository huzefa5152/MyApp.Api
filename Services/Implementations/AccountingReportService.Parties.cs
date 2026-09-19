using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models.Accounting;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>Party-facing reports: one party's ledger, and the aged
    /// receivables / payables.</summary>
    public partial class AccountingReportService
    {
        // ── Party ledger ──────────────────────────────────────────────────────

        public async Task<PartyLedgerDto?> GetPartyLedgerAsync(
            int companyId, string partyType, int partyId, DateTime? from, DateTime? to)
        {
            var kind = (partyType ?? "").Trim();
            var isClient = string.Equals(kind, "Client", StringComparison.OrdinalIgnoreCase);
            var isSupplier = string.Equals(kind, "Supplier", StringComparison.OrdinalIgnoreCase);
            if (!isClient && !isSupplier) return null;

            // The party must belong to THIS company. PartyId on a journal line
            // is a soft reference, so an unscoped lookup would happily print
            // another tenant's name at the top of this report.
            var name = isClient
                ? await _context.Clients.AsNoTracking()
                    .Where(c => c.Id == partyId && c.CompanyId == companyId).Select(c => c.Name).FirstOrDefaultAsync()
                : await _context.Suppliers.AsNoTracking()
                    .Where(s => s.Id == partyId && s.CompanyId == companyId).Select(s => s.Name).FirstOrDefaultAsync();
            if (name == null) return null;

            var canonical = isClient ? "Client" : "Supplier";

            // Every line the posting engine tags with this party. That tag is
            // written on the control-account leg of each document, so this and
            // the control account agree by construction rather than by luck.
            var baseQuery = _context.JournalLines.AsNoTracking()
                .Where(l => l.JournalEntry.CompanyId == companyId
                         && l.PartyType == canonical
                         && l.PartyId == partyId);

            var opening = from.HasValue
                ? await baseQuery.Where(l => l.JournalEntry.Date < from.Value.Date)
                    .SumAsync(l => (decimal?)(l.Debit - l.Credit)) ?? 0m
                : 0m;

            var rows = await baseQuery
                .Where(l => (from == null || l.JournalEntry.Date >= from.Value.Date)
                         && (to == null || l.JournalEntry.Date <= to.Value.Date))
                .OrderBy(l => l.JournalEntry.Date).ThenBy(l => l.JournalEntryId).ThenBy(l => l.Id)
                .Select(l => new
                {
                    l.JournalEntryId,
                    l.JournalEntry.EntryNo,
                    l.JournalEntry.Date,
                    l.JournalEntry.SourceDocType,
                    l.JournalEntry.SourceDocId,
                    l.JournalEntry.Narration,
                    l.Description,
                    l.Debit,
                    l.Credit,
                })
                .ToListAsync();

            var dto = new PartyLedgerDto
            {
                PartyType = canonical,
                PartyId = partyId,
                PartyName = name,
                From = from?.Date,
                To = to?.Date,
                OpeningBalance = opening,
            };

            var running = opening;
            foreach (var r in rows)
            {
                running += r.Debit - r.Credit;
                dto.Rows.Add(new PartyLedgerRowDto
                {
                    JournalEntryId = r.JournalEntryId,
                    EntryNo = r.EntryNo,
                    Date = r.Date,
                    SourceDocType = r.SourceDocType.ToString(),
                    SourceDocId = r.SourceDocId,
                    Reference = r.Narration,
                    Description = r.Description,
                    Debit = r.Debit,
                    Credit = r.Credit,
                    RunningBalance = running,
                });
            }
            dto.ClosingBalance = running;
            return dto;
        }

        // ── Aging ─────────────────────────────────────────────────────────────

        public Task<AgedReportDto> GetAgedReceivablesAsync(int companyId, DateTime? asOf) =>
            BuildAgingAsync(companyId, receivables: true, asOf);

        public Task<AgedReportDto> GetAgedPayablesAsync(int companyId, DateTime? asOf) =>
            BuildAgingAsync(companyId, receivables: false, asOf);

        /// <summary>
        /// Aging reads the DOCUMENTS, not the ledger, and that is deliberate:
        /// the ledger knows a party's balance but not which invoice it belongs
        /// to, and an age without a document to measure from is meaningless.
        /// The control account is what the total is checked against.
        ///
        /// What is outstanding is measured against the COLLECTIBLE — grand total
        /// less anything withheld at source — because the withheld slice is
        /// never coming from the customer and would otherwise sit in the oldest
        /// bucket for ever.
        /// </summary>
        private async Task<AgedReportDto> BuildAgingAsync(int companyId, bool receivables, DateTime? asOf)
        {
            var today = (asOf ?? PakistanClock.Today).Date;
            var report = new AgedReportDto { Kind = receivables ? "Receivables" : "Payables", AsOf = today };

            List<(int PartyId, string Name, DateTime Anchor, decimal Due)> open;
            if (receivables)
            {
                open = (await _context.Invoices.AsNoTracking()
                        .Where(i => i.CompanyId == companyId && !i.IsDemo && !i.IsCancelled
                                 // Notes are adjustments to a sale, not sales of
                                 // their own; including them would age the same
                                 // money twice, in opposite directions.
                                 && i.DocumentType != 9 && i.DocumentType != 10
                                 && i.Date <= today)
                        .Select(i => new
                        {
                            i.ClientId,
                            Name = i.Client!.Name,
                            i.Date,
                            i.DueDate,
                            Collectible = i.GrandTotal - i.WithholdingTaxAmount,
                            i.AmountPaid,
                        })
                        .ToListAsync())
                    .Select(x => (x.ClientId, x.Name, (x.DueDate ?? x.Date).Date, x.Collectible - x.AmountPaid))
                    .Where(x => x.Item4 > 0m)
                    .ToList();
            }
            else
            {
                open = (await _context.PurchaseBills.AsNoTracking()
                        .Where(b => b.CompanyId == companyId && b.Date <= today)
                        .Select(b => new
                        {
                            b.SupplierId,
                            Name = b.Supplier!.Name,
                            b.Date,
                            b.DueDate,
                            Collectible = b.GrandTotal - b.WithholdingTaxAmount,
                            b.AmountPaid,
                        })
                        .ToListAsync())
                    .Select(x => (x.SupplierId, x.Name, (x.DueDate ?? x.Date).Date, x.Collectible - x.AmountPaid))
                    .Where(x => x.Item4 > 0m)
                    .ToList();
            }

            foreach (var group in open.GroupBy(x => new { x.PartyId, x.Name }))
            {
                var row = new AgedPartyRowDto
                {
                    PartyId = group.Key.PartyId,
                    Name = group.Key.Name,
                    OpenDocuments = group.Count(),
                };
                foreach (var doc in group)
                {
                    var days = (today - doc.Anchor).Days;
                    // Not yet due, or due today, is Current — an invoice is not
                    // old on the morning it falls due.
                    if (days <= 0) row.Current += doc.Due;
                    else if (days <= 30) row.Days1To30 += doc.Due;
                    else if (days <= 60) row.Days31To60 += doc.Due;
                    else if (days <= 90) row.Days61To90 += doc.Due;
                    else row.Over90 += doc.Due;
                }
                row.Total = row.Current + row.Days1To30 + row.Days31To60 + row.Days61To90 + row.Over90;
                report.Rows.Add(row);
            }

            report.Rows = report.Rows.OrderByDescending(r => r.Total).ToList();
            report.Total = report.Rows.Sum(r => r.Total);
            report.Current = report.Rows.Sum(r => r.Current);
            report.Days1To30 = report.Rows.Sum(r => r.Days1To30);
            report.Days31To60 = report.Rows.Sum(r => r.Days31To60);
            report.Days61To90 = report.Rows.Sum(r => r.Days61To90);
            report.Over90 = report.Rows.Sum(r => r.Over90);
            return report;
        }
    }
}
