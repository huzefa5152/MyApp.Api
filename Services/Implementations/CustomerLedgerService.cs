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
        /// <summary>Money paid back OUT to a customer against their own balance.
        /// See the refund block in <see cref="BuildEntriesAsync"/>.</summary>
        public const string TypeRefund = "Refund";

        /// <inheritdoc/>
        public async Task<CustomerLedgerDto> GetForClientAsync(
            int companyId, int clientId, DateTime? from, DateTime? to,
            string? type, int page, int? pageSize)
        {
            // Resolve the caller-supplied id INSIDE the company — never trust it.
            var client = await _context.Clients.AsNoTracking()
                .Where(c => c.Id == clientId && c.CompanyId == companyId)
                .Select(c => new { c.Id, c.Name })
                .FirstOrDefaultAsync();
            if (client == null)
                throw new InvalidOperationException("Customer not found.");

            // ONE client record, deliberately — see the interface docs. Callers
            // that want the whole ClientGroup use GetForCustomerAsync instead.
            return await ComposeAsync(
                companyId, new[] { client.Id }, client.Id, client.Name,
                from, to, type, method: null, page, pageSize);
        }

        /// <inheritdoc/>
        public async Task<CustomerLedgerDto> GetForCustomerAsync(
            int companyId, int clientId, DateTime? from, DateTime? to,
            string? type, string? method, int page, int? pageSize)
        {
            // Resolve the caller-supplied id INSIDE the company — never trust it.
            var client = await _context.Clients.AsNoTracking()
                .Where(c => c.Id == clientId && c.CompanyId == companyId)
                .Select(c => new { c.Id, c.Name, c.ClientGroupId })
                .FirstOrDefaultAsync();
            if (client == null)
                throw new InvalidOperationException("Customer not found.");

            // The whole ClientGroup, scoped to THIS company — the same identity
            // GetAllCustomersAsync rolls its rows up by (ClientGroupId ?? -Id).
            // Client.ClientGroupId carries a plain, NON-unique index
            // (AppDbContext:257), so two records of one company sharing a group
            // is normal — merging duplicate customer records is what groups are
            // for. Reporting only the anchor here would put a different closing
            // balance in the drill-down than on the row above it.
            var members = client.ClientGroupId.HasValue
                ? await _context.Clients.AsNoTracking()
                    .Where(c => c.CompanyId == companyId && c.ClientGroupId == client.ClientGroupId.Value)
                    .Select(c => new { c.Id, c.Name })
                    .ToListAsync()
                : new[] { new { client.Id, client.Name } }.ToList();

            // Anchor id/name picked EXACTLY as GetAllCustomersAsync picks them
            // (Min(Id), and the name of the lowest id), so the drill-down and the
            // aggregate row identify the same customer.
            var anchor = members.OrderBy(c => c.Id).First();

            return await ComposeAsync(
                companyId, members.Select(m => m.Id).ToList(), anchor.Id, anchor.Name,
                from, to, type, method, page, pageSize);
        }

        /// <summary>
        /// The shared trail pipeline: build → order → window → run the balance →
        /// hide by type/method → page. <paramref name="clientIds"/> is ONE id for
        /// <see cref="GetForClientAsync"/> and every group member for
        /// <see cref="GetForCustomerAsync"/>; with a single id the result is
        /// identical to the pre-group behaviour, which is what keeps
        /// <c>ClientService.GetStatementAsync</c> and the Client Ledger report
        /// unchanged.
        ///
        /// Summing members here reproduces the aggregate row exactly, because
        /// <see cref="GetAllCustomersAsync"/> applies the same per-client rules
        /// (including the de-duplication rule) and then sums across the group.
        /// </summary>
        private async Task<CustomerLedgerDto> ComposeAsync(
            int companyId, IReadOnlyCollection<int> clientIds, int anchorId, string anchorName,
            DateTime? from, DateTime? to, string? type, string? method, int page, int? pageSize)
        {
            var entries = await BuildEntriesAsync(companyId, clientIds);

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

            // Payment method — receipts only, so choosing one implicitly narrows
            // to receipts. Like `type` it HIDES rows: it runs after the balance
            // above, so nothing it removes can move a balance or the closing
            // figure. `Total` therefore counts the rows left after BOTH filters,
            // which is what the caller pages through.
            if (!string.IsNullOrWhiteSpace(method))
            {
                var wanted = method.Trim();
                ordered = ordered
                    .Where(e => string.Equals(e.Method, wanted, StringComparison.OrdinalIgnoreCase))
                    .ToList();
            }

            var size = PaginationHelper.Clamp(pageSize, 50, PaginationHelper.AuditMax);
            var pageNo = PaginationHelper.ClampPage(page);
            var total = ordered.Count;

            ordered.Reverse();                       // newest-first for display

            return new CustomerLedgerDto
            {
                ClientId = anchorId,
                ClientName = anchorName,
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
        /// thread-safe); each filters on BOTH CompanyId and the client set.
        ///
        /// <paramref name="clientIds"/> is normally ONE id. It takes a set only
        /// so a ClientGroup can be read in four queries instead of four per
        /// member; with a single id every filter below is exactly the equality
        /// test it replaced, so the single-client behaviour is unchanged.
        ///
        /// The de-duplication rule stays per INVOICE OWNER, not per set: a
        /// payment whose contact is the invoice's own client is already carried
        /// by its contact-sourced row, so its allocations are skipped. That is
        /// the same test <see cref="GetAllCustomersAsync"/> makes before it sums
        /// a group, which is why the two agree.
        /// </summary>
        private async Task<List<CustomerLedgerEntryDto>> BuildEntriesAsync(
            int companyId, IReadOnlyCollection<int> clientIds)
        {
            var entries = new List<CustomerLedgerEntryDto>();
            if (clientIds.Count == 0) return entries;
            var ids = clientIds as ICollection<int> ?? clientIds.ToList();

            // Documents — invoices and BOTH note kinds. Demo bills are excluded
            // from every KPI (house rule) and cancelled bills carry no balance.
            var docs = await _context.Invoices.AsNoTracking()
                .Where(i => ids.Contains(i.ClientId) && i.CompanyId == companyId
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
                        // KNOWN LIMITATION — withholding tax (accepted 2026-08-30,
                        // inherited from the statement this replaced, NOT a
                        // regression). We charge the customer the full GrandTotal,
                        // but InvoiceService.cs:218 computes
                        //   BalanceDue = Collectible(GrandTotal, WHT) − AmountPaid
                        // where Collectible = GrandTotal − WithholdingTaxAmount.
                        // So for any invoice with WithholdingTaxAmount > 0 this
                        // ledger overstates A/R by the withheld slice — money
                        // reclaimable from FBR, not owed by the customer — and the
                        // closing balance will not equal BalanceDue. Fixing it
                        // means charging Collectible here and booking the withheld
                        // slice as its own row; deliberately deferred.
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
                            && p.ContactId != null && ids.Contains(p.ContactId.Value)
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

            // Money paid back OUT to this customer and held against their balance
            // — a refund of an advance. NEW with the 2026-08-31 payee change and
            // additive only: before it, a money-out payment naming a Client could
            // only reach an income/expense account and never touched the client's
            // balance, so a payment written earlier yields no row here (its
            // on-account cash is 0). It now DEBITS the client's Accounts
            // receivable in the GL (PostingService.PostPaymentAsync), so it has to
            // appear on the trail too, or the closing balance stops agreeing with
            // both the ledger and the A/R column on the Customers screen.
            //
            // Credit, not Debit: a refund undoes an advance, so it moves the
            // balance the same way an invoice does — back towards "they owe us".
            var refunds = (await PartyOnAccount.Query(_context, "Client", companyId, ids)
                    .Where(r => r.Direction == PaymentDirection.Payment)
                    .ToListAsync())
                .Where(r => r.Amount != 0m);

            foreach (var r in refunds)
                entries.Add(new CustomerLedgerEntryDto
                {
                    Date = r.Date,
                    Type = TypeRefund,
                    Reference = "PMT-" + r.Number,
                    DocId = r.PaymentId,
                    Credit = r.Amount,
                    BankAccount = r.BankAccountName,
                    Description = r.Description,
                });

            // Cash that settles THIS client's invoices from a receipt naming a
            // DIFFERENT contact. PaymentService.AssertInvoicesBelongToCompanyAsync
            // only checks that an allocation's invoice belongs to the same
            // COMPANY — never that it belongs to the receipt's contact — so a
            // receipt whose contact is "Other" (or another client) can settle
            // this client's bill. That is reachable, not theoretical: an "Other"
            // receipt is REQUIRED to carry allocations (PaymentService's
            // AssertAllocationsPresent / IsCustomerReceipt). Without these rows the
            // invoice's AmountPaid rises with nothing to show for it on the
            // customer's trail and the closing balance stops agreeing with
            // BalanceDue. The old allocation-sourced statement did capture this
            // money, so omitting it would be a one-directional regression.
            //
            // DE-DUPLICATION RULE — a payment reaches this ledger through EXACTLY
            // ONE of the two cash sources, chosen by whose receipt it is:
            //   • contact IS this client  → the contact-sourced row above, at the
            //     FULL Payment.Amount so unallocated cash shows. Every allocation
            //     it carries is already inside that amount, so it contributes no
            //     allocation row here.
            //   • contact is NOT this client → one row per allocation against this
            //     client's invoices, at the allocation's cash Amount only. The
            //     rest of that payment is somebody else's money.
            // Adjustments are never part of Payment.Amount (the cash total is
            // Σ Amount), so they are collected below for BOTH kinds and can never
            // double count against either.
            //
            // Nuance, deliberate: when client Y's receipt settles client X's
            // invoice, Y's trail still shows Y's full cash. That is the stated
            // design (cash received from Y), and X now correctly shows the slice
            // that settled X's bill.
            var allocatedCash = await (
                from a in _context.PaymentAllocations.AsNoTracking()
                join p in _context.Payments.AsNoTracking() on a.PaymentId equals p.Id
                join inv in _context.Invoices.AsNoTracking() on a.InvoiceId equals inv.Id
                where a.Amount != 0m
                      && ids.Contains(inv.ClientId) && inv.CompanyId == companyId
                      && !inv.IsDemo && !inv.IsCancelled
                      && p.CompanyId == companyId && !p.IsCancelled
                      && p.Direction == PaymentDirection.Receipt
                select new { p.Id, p.Number, p.Date, p.Method, p.BankAccountName,
                             p.ContactType, p.ContactId, a.Amount, inv.InvoiceNumber,
                             InvoiceClientId = inv.ClientId }
            ).ToListAsync();

            foreach (var a in allocatedCash)
            {
                // Already represented by its contact-sourced row above.
                if (IsContactOf(a.ContactType, a.ContactId, a.InvoiceClientId)) continue;
                entries.Add(new CustomerLedgerEntryDto
                {
                    Date = a.Date,
                    Type = TypeReceipt,
                    Reference = "RCP-" + a.Number,
                    DocId = a.Id,
                    Debit = a.Amount,
                    Method = a.Method,
                    BankAccount = a.BankAccountName,
                    Description = $"Applied to INV-{a.InvoiceNumber} from a receipt recorded against another contact",
                });
            }

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
                      && ids.Contains(inv.ClientId) && inv.CompanyId == companyId
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

            // Cash allocated to a client's invoice from a receipt naming another
            // contact — same de-duplication rule as BuildEntriesAsync: a payment
            // counts EITHER through its contact (at the full amount) OR through
            // its allocations (at allocation amounts), never both.
            var allocatedCash = await (
                from a in _context.PaymentAllocations.AsNoTracking()
                join p in _context.Payments.AsNoTracking() on a.PaymentId equals p.Id
                join inv in _context.Invoices.AsNoTracking() on a.InvoiceId equals inv.Id
                where a.Amount != 0m
                      && inv.CompanyId == companyId && !inv.IsDemo && !inv.IsCancelled
                      && p.CompanyId == companyId && !p.IsCancelled
                      && p.Direction == PaymentDirection.Receipt
                select new { inv.ClientId, p.Date, p.ContactType, p.ContactId, a.Amount }
            ).ToListAsync();

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

            // Refunds paid back to a customer — the aggregate mirror of the refund
            // block in BuildEntriesAsync, so a row and its drill-down agree.
            var refunds = (await PartyOnAccount.Query(_context, "Client", companyId)
                    .Where(r => r.Direction == PaymentDirection.Payment)
                    .ToListAsync())
                .Where(r => r.Amount != 0m);

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
            foreach (var a in allocatedCash)
            {
                if (IsContactOf(a.ContactType, a.ContactId, a.ClientId)) continue;
                Add(a.ClientId, a.Date, 0m, a.Amount);
            }
            foreach (var a in adjustments) Add(a.ClientId, a.Date, 0m, a.AdjustmentAmount);
            foreach (var r in refunds) Add(r.PartyId, r.Date, r.Amount, 0m);

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

        /// <summary>
        /// Is this payment's contact the given client? The discriminator of the
        /// de-duplication rule: true means the payment already reaches that
        /// client's ledger through its contact-sourced row at the full
        /// Payment.Amount, so its allocations must NOT be added again.
        ///
        /// ContactType is normalised on write (trimmed, canonical case) but
        /// legacy rows may hold "client" / " Client ", so compare trimmed and
        /// case-insensitively — the same comparison the EF-side receipts query
        /// makes, kept in step with it.
        /// </summary>
        private static bool IsContactOf(string? contactType, int? contactId, int clientId) =>
            contactId == clientId
            && string.Equals(contactType?.Trim(), "Client", StringComparison.OrdinalIgnoreCase);

        private sealed class Bucket
        {
            public decimal Opening;
            public decimal Credit;
            public decimal Debit;
        }
    }
}
