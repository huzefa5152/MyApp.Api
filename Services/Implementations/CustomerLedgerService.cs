using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models.Accounting;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <inheritdoc cref="ICustomerLedgerService"/>
    public class CustomerLedgerService : ICustomerLedgerService
    {
        private readonly AppDbContext _context;

        public CustomerLedgerService(AppDbContext context)
        {
            _context = context;
        }

        // ── Document-type codes ────────────────────────────────────────────
        // Invoice.DocumentType: null/0 = sale invoice, 9 = DEBIT NOTE,
        // 10 = CREDIT NOTE. Pinned by Models/Invoice.cs:102 & :151,
        // InvoiceService.CreateNoteAsync ("10 = CREDIT NOTE … 9 = DEBIT NOTE"),
        // PostingService:228 (isCreditNote = DocumentType == 10) and
        // CompanyService:319-325. Do not swap these — a credit note posted to
        // the wrong column silently reverses a customer's balance.
        private const int DebitNoteType = 9;
        private const int CreditNoteType = 10;

        public const string TypeInvoice = "Invoice";
        public const string TypeDebitNote = "Debit Note";
        public const string TypeCreditNote = "Credit Note";
        public const string TypeReceipt = "Receipt";
        public const string TypeAdjustment = "Adjustment";

        /// <inheritdoc/>
        public async Task<CustomerLedgerDto> GetForClientAsync(
            int companyId, int clientId, DateTime? from, DateTime? to,
            string? type, int page, int pageSize)
        {
            // Resolve the caller-supplied id INSIDE the company — never trust it.
            var client = await _context.Clients.AsNoTracking()
                .Where(c => c.Id == clientId && c.CompanyId == companyId)
                .Select(c => new { c.Id, c.Name })
                .FirstOrDefaultAsync();
            if (client == null)
                throw new InvalidOperationException("Customer not found.");

            var entries = await BuildEntriesAsync(companyId, clientId);

            // Chronological. On the same date a document (Credit column) lands
            // before the money that settles it (Debit column), mirroring the
            // workbook; DocId/Reference break any remaining tie deterministically.
            var ordered = entries
                .OrderBy(e => e.Date)
                .ThenByDescending(e => e.Credit)
                .ThenBy(e => e.Type, StringComparer.Ordinal)
                .ThenBy(e => e.DocId ?? 0)
                .ThenBy(e => e.Reference, StringComparer.Ordinal)
                .ToList();

            // Opening balance = everything strictly before `from`, collapsed to
            // one number; the window then carries a running balance from it.
            decimal opening = 0m;
            if (from.HasValue)
            {
                var start = from.Value.Date;
                opening = ordered.Where(e => e.Date.Date < start).Sum(e => e.Credit - e.Debit);
                ordered = ordered.Where(e => e.Date.Date >= start).ToList();
            }
            if (to.HasValue)
            {
                var end = to.Value.Date;
                ordered = ordered.Where(e => e.Date.Date <= end).ToList();
            }

            // Running balance over the WHOLE window, computed before any type
            // filter. Filtering by type must hide rows, never re-base their
            // balance or the closing figure.
            var running = opening;
            foreach (var e in ordered)
            {
                running += e.Credit - e.Debit;
                e.Balance = running;
            }
            var closing = running;
            var totalCredit = ordered.Sum(e => e.Credit);
            var totalDebit = ordered.Sum(e => e.Debit);

            if (!string.IsNullOrWhiteSpace(type))
            {
                var wanted = type.Trim();
                ordered = ordered
                    .Where(e => string.Equals(e.Type, wanted, StringComparison.OrdinalIgnoreCase))
                    .ToList();
            }

            var size = PaginationHelper.Clamp(pageSize, 50, PaginationHelper.AuditMax);
            var pageNo = PaginationHelper.ClampPage(page);
            var total = ordered.Count;

            ordered.Reverse();                       // newest-first for display

            return new CustomerLedgerDto
            {
                ClientId = client.Id,
                ClientName = client.Name,
                OpeningBalance = opening,
                ClosingBalance = closing,
                Outstanding = closing > 0m ? closing : 0m,
                Advance = closing < 0m ? -closing : 0m,
                TotalCredit = totalCredit,
                TotalDebit = totalDebit,
                Total = total,
                Page = pageNo,
                PageSize = size,
                Entries = ordered.Skip((pageNo - 1) * size).Take(size).ToList(),
            };
        }

        /// <summary>
        /// Every ledger row for one customer, unordered and unfiltered by date.
        /// Four sequential reads (never concurrent — AppDbContext is not
        /// thread-safe); each filters on BOTH CompanyId and the client.
        /// </summary>
        private async Task<List<CustomerLedgerEntryDto>> BuildEntriesAsync(int companyId, int clientId)
        {
            var entries = new List<CustomerLedgerEntryDto>();

            // Documents — invoices and BOTH note kinds. Demo bills are excluded
            // from every KPI (house rule) and cancelled bills carry no balance.
            var docs = await _context.Invoices.AsNoTracking()
                .Where(i => i.ClientId == clientId && i.CompanyId == companyId
                            && !i.IsDemo && !i.IsCancelled)
                .Select(i => new { i.Id, i.InvoiceNumber, i.Date, i.GrandTotal, i.DocumentType })
                .ToListAsync();

            foreach (var d in docs)
            {
                // Invoice and Debit Note increase what the customer owes →
                // Credit column. Credit Note reverses the sale → Debit column.
                // Matches the GL: PostingService debits A/R for an invoice and a
                // debit note, credits it for a credit note.
                if (d.DocumentType == CreditNoteType)
                {
                    entries.Add(new CustomerLedgerEntryDto
                    {
                        Date = d.Date,
                        Type = TypeCreditNote,
                        Reference = "CN-" + d.InvoiceNumber,
                        DocId = d.Id,
                        Debit = d.GrandTotal,
                    });
                }
                else
                {
                    var isDebitNote = d.DocumentType == DebitNoteType;
                    entries.Add(new CustomerLedgerEntryDto
                    {
                        Date = d.Date,
                        Type = isDebitNote ? TypeDebitNote : TypeInvoice,
                        Reference = (isDebitNote ? "DN-" : "INV-") + d.InvoiceNumber,
                        DocId = d.Id,
                        Credit = d.GrandTotal,
                    });
                }
            }

            // Receipts, at their FULL Payment.Amount — the unallocated part is
            // real money received and must show. Summing allocations instead (as
            // the old statement did) hid every advance.
            //
            // ContactType is normalised on write (trimmed, canonical case) but
            // LEGACY rows may still hold "client"/" Client ", so compare
            // case-insensitively after trimming.
            var receipts = await _context.Payments.AsNoTracking()
                .Where(p => p.CompanyId == companyId
                            && p.Direction == PaymentDirection.Receipt
                            && !p.IsCancelled
                            && p.ContactId == clientId
                            && p.ContactType != null
                            && p.ContactType.Trim().ToLower() == "client")
                .Select(p => new { p.Id, p.Number, p.Date, p.Amount, p.Method, p.BankAccountName, p.Description })
                .ToListAsync();

            foreach (var r in receipts)
                entries.Add(new CustomerLedgerEntryDto
                {
                    Date = r.Date,
                    Type = TypeReceipt,
                    Reference = "RCP-" + r.Number,
                    DocId = r.Id,
                    Debit = r.Amount,
                    Method = r.Method,
                    BankAccount = r.BankAccountName,
                    Description = r.Description,
                });

            // Settle-remainder adjustments — the non-cash slice that ALSO clears
            // the invoice (a discount, a write-off). Invoice.AmountPaid counts
            // Amount + AdjustmentAmount, so omitting these (as the old statement
            // did) left the closing balance disagreeing with A/R by every
            // discount ever given. The receipt row above carries only the cash,
            // so there is no double count.
            var adjustments = await (
                from a in _context.PaymentAllocations.AsNoTracking()
                join p in _context.Payments.AsNoTracking() on a.PaymentId equals p.Id
                join inv in _context.Invoices.AsNoTracking() on a.InvoiceId equals inv.Id
                where a.AdjustmentAmount != 0m
                      && inv.ClientId == clientId && inv.CompanyId == companyId
                      && !inv.IsDemo && !inv.IsCancelled
                      && p.CompanyId == companyId && !p.IsCancelled
                      && p.Direction == PaymentDirection.Receipt
                select new { p.Id, p.Number, p.Date, a.AdjustmentAmount, inv.InvoiceNumber }
            ).ToListAsync();

            foreach (var a in adjustments)
                entries.Add(new CustomerLedgerEntryDto
                {
                    Date = a.Date,
                    Type = TypeAdjustment,
                    Reference = "RCP-" + a.Number,
                    DocId = a.Id,
                    Debit = a.AdjustmentAmount,
                    Description = $"Settled against INV-{a.InvoiceNumber}",
                });

            return entries;
        }

        /// <inheritdoc/>
        public async Task<List<CustomerLedgerRowDto>> GetAllCustomersAsync(
            int companyId, DateTime? from, DateTime? to)
        {
            // Every customer of THIS company. Rolling up by ClientGroupId means
            // the same legal entity carried in more than one row collapses into
            // one line, matching DashboardService.ComputeSalesAsync.
            var clients = await _context.Clients.AsNoTracking()
                .Where(c => c.CompanyId == companyId)
                .Select(c => new { c.Id, c.Name, c.ClientGroupId })
                .ToListAsync();
            if (clients.Count == 0) return new List<CustomerLedgerRowDto>();

            var clientIds = clients.Select(c => c.Id).ToHashSet();

            // Sequential reads — never two concurrent AppDbContext operations.
            var docs = await _context.Invoices.AsNoTracking()
                .Where(i => i.CompanyId == companyId && !i.IsDemo && !i.IsCancelled)
                .Select(i => new { i.ClientId, i.Date, i.GrandTotal, i.DocumentType })
                .ToListAsync();

            var receipts = await _context.Payments.AsNoTracking()
                .Where(p => p.CompanyId == companyId
                            && p.Direction == PaymentDirection.Receipt
                            && !p.IsCancelled
                            && p.ContactId != null
                            && p.ContactType != null
                            && p.ContactType.Trim().ToLower() == "client")
                .Select(p => new { ClientId = p.ContactId!.Value, p.Date, p.Amount })
                .ToListAsync();

            var adjustments = await (
                from a in _context.PaymentAllocations.AsNoTracking()
                join p in _context.Payments.AsNoTracking() on a.PaymentId equals p.Id
                join inv in _context.Invoices.AsNoTracking() on a.InvoiceId equals inv.Id
                where a.AdjustmentAmount != 0m
                      && inv.CompanyId == companyId && !inv.IsDemo && !inv.IsCancelled
                      && p.CompanyId == companyId && !p.IsCancelled
                      && p.Direction == PaymentDirection.Receipt
                select new { inv.ClientId, p.Date, a.AdjustmentAmount }
            ).ToListAsync();

            // (clientId → opening, credit, debit) for the window.
            var acc = clientIds.ToDictionary(id => id, _ => new Bucket());
            var start = from?.Date;
            var end = to?.Date;

            void Add(int clientId, DateTime date, decimal credit, decimal debit)
            {
                // A receipt's ContactId is a soft reference; a row pointing at a
                // client outside this company is ignored rather than trusted.
                if (!acc.TryGetValue(clientId, out var b)) return;
                var day = date.Date;
                if (start.HasValue && day < start.Value) { b.Opening += credit - debit; return; }
                if (end.HasValue && day > end.Value) return;
                b.Credit += credit;
                b.Debit += debit;
            }

            foreach (var d in docs)
            {
                if (d.DocumentType == CreditNoteType) Add(d.ClientId, d.Date, 0m, d.GrandTotal);
                else Add(d.ClientId, d.Date, d.GrandTotal, 0m);
            }
            foreach (var r in receipts) Add(r.ClientId, r.Date, 0m, r.Amount);
            foreach (var a in adjustments) Add(a.ClientId, a.Date, 0m, a.AdjustmentAmount);

            return clients
                .GroupBy(c => c.ClientGroupId ?? -c.Id)
                .Select(g =>
                {
                    var opening = g.Sum(c => acc[c.Id].Opening);
                    var credit = g.Sum(c => acc[c.Id].Credit);
                    var debit = g.Sum(c => acc[c.Id].Debit);
                    var closing = opening + credit - debit;
                    return new CustomerLedgerRowDto
                    {
                        // Every row in a real ClientGroup carries the same master
                        // name; Min/Max are just deterministic pickers (same
                        // convention as DashboardService).
                        ClientId = g.Min(c => c.Id),
                        ClientName = g.OrderBy(c => c.Id).Select(c => c.Name).FirstOrDefault() ?? "(unknown)",
                        Opening = opening,
                        Invoiced = credit,
                        Received = debit,
                        Outstanding = closing > 0m ? closing : 0m,
                        Advance = closing < 0m ? -closing : 0m,
                        Closing = closing,
                    };
                })
                .OrderByDescending(r => r.Closing)
                .ThenBy(r => r.ClientName, StringComparer.OrdinalIgnoreCase)
                .ToList();
        }

        private sealed class Bucket
        {
            public decimal Opening;
            public decimal Credit;
            public decimal Debit;
        }
    }
}
