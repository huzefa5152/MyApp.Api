using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Models.Accounting;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// A customer's opening balance, entered by hand. One migrated document per
    /// client (<see cref="ClientOpeningBalance.Ref"/>): an invoice when they owe
    /// us, a credit note when they had paid ahead. Setting it again REPLACES that
    /// document, so a correction never adds a second opening.
    ///
    /// Everything that reads a customer's balance (ledger, statement, client
    /// ledger report, receipts' FIFO split) reads documents, so it picks this up
    /// with no change. The ledger posts it Dr/Cr Accounts receivable against
    /// Retained earnings (PostingService) -- a journal entry, not an edit of the
    /// account's opening figure, so a GL rebuild recreates it exactly.
    ///
    /// Deliberately NOT the customer-ledger import's cutover: that sets the GL
    /// lock date and REPLACES the A/R account's opening figure, which is only
    /// right for a company with no ledger yet.
    /// </summary>
    public class ClientOpeningBalanceService : IClientOpeningBalanceService
    {
        private const int CreditNoteType = 10;

        private readonly AppDbContext _db;
        private readonly IPostingService _posting;

        public ClientOpeningBalanceService(AppDbContext db, IPostingService posting)
        {
            _db = db;
            _posting = posting;
        }

        public async Task<ClientOpeningBalanceDto> GetAsync(int companyId, int clientId)
        {
            await AssertClientAsync(companyId, clientId);
            var doc = await FindAsync(companyId, clientId, track: false);
            return ToDto(clientId, doc);
        }

        public async Task<ClientOpeningBalanceDto> SetAsync(int companyId, int clientId, SetClientOpeningBalanceDto dto)
        {
            await AssertClientAsync(companyId, clientId);
            var amount = Math.Round(dto.Amount, 2, MidpointRounding.AwayFromZero);
            var date = dto.Date.Date;

            await using var tx = await _db.Database.BeginTransactionAsync();
            var doc = await FindAsync(companyId, clientId, track: true);

            if (doc != null)
            {
                await _posting.AssertPeriodOpenAsync(companyId, doc.Date);
                // Receipts already applied to the opening invoice must stay covered.
                if (doc.AmountPaid > 0m)
                {
                    if (amount < doc.AmountPaid)
                        throw new InvalidOperationException(
                            $"Receipts of {doc.AmountPaid:N2} are already applied to this opening balance. " +
                            "It cannot go below that -- remove those allocations first.");
                }
            }
            if (amount != 0m) await _posting.AssertPeriodOpenAsync(companyId, date);

            if (amount == 0m)
            {
                if (doc != null)
                {
                    await _posting.RemoveForSourceAsync(companyId, SourceDocType.Invoice, doc.Id);
                    _db.Invoices.Remove(doc);
                    await _db.SaveChangesAsync();
                }
                await tx.CommitAsync();
                return ToDto(clientId, null);
            }

            var kind = amount > 0m ? (int?)null : CreditNoteType;
            var gross = Math.Abs(amount);

            if (doc != null && doc.DocumentType != kind)
            {
                // Switching between "owes" and "paid ahead" changes the document's
                // kind, and with it its number sequence -- replace the row.
                await _posting.RemoveForSourceAsync(companyId, SourceDocType.Invoice, doc.Id);
                _db.Invoices.Remove(doc);
                await _db.SaveChangesAsync();
                doc = null;
            }

            if (doc == null)
            {
                doc = new Invoice
                {
                    CompanyId = companyId,
                    ClientId = clientId,
                    InvoiceNumber = await MigratedDocumentNumbers.NextAsync(_db, companyId),
                    DocumentType = kind,
                    AmountInWords = "",
                    IsMigrated = true,
                    IsFbrExcluded = true,
                    ExternalRef = ClientOpeningBalance.Ref(companyId, clientId),
                    NoteReason = kind == CreditNoteType ? "Opening balance" : null,
                    CreatedAt = DateTime.UtcNow,
                };
                _db.Invoices.Add(doc);
            }

            doc.Date = date;
            doc.Subtotal = gross;
            doc.GSTRate = 0m;
            doc.GSTAmount = 0m;
            doc.GrandTotal = gross;
            await _db.SaveChangesAsync();

            await _posting.PostInvoiceAsync(doc);
            await tx.CommitAsync();
            return ToDto(clientId, doc);
        }

        private async Task AssertClientAsync(int companyId, int clientId)
        {
            if (!await _db.Clients.AnyAsync(c => c.Id == clientId && c.CompanyId == companyId))
                throw new KeyNotFoundException("Customer not found.");
        }

        private Task<Invoice?> FindAsync(int companyId, int clientId, bool track)
        {
            var key = ClientOpeningBalance.Ref(companyId, clientId);
            var q = _db.Invoices.Where(i => i.CompanyId == companyId && i.ClientId == clientId && i.ExternalRef == key);
            return (track ? q : q.AsNoTracking()).FirstOrDefaultAsync();
        }

        private static ClientOpeningBalanceDto ToDto(int clientId, Invoice? doc) => new()
        {
            ClientId = clientId,
            Amount = doc == null ? 0m : doc.DocumentType == CreditNoteType ? -doc.GrandTotal : doc.GrandTotal,
            Date = doc?.Date,
            AmountSettled = doc?.AmountPaid ?? 0m,
            DocumentId = doc?.Id,
        };
    }
}
