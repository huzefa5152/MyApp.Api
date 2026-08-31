using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Models.Accounting;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class PaymentService : IPaymentService
    {
        private readonly IPaymentRepository _repo;
        private readonly AppDbContext _context;
        private readonly IPostingService _posting;
        private readonly ILogger<PaymentService> _logger;

        public PaymentService(IPaymentRepository repo, AppDbContext context,
            IPostingService posting, ILogger<PaymentService> logger)
        {
            _repo = repo;
            _context = context;
            _posting = posting;
            _logger = logger;
        }

        // ── Reads ────────────────────────────────────────────────────────────

        public async Task<PagedResult<PaymentDto>> GetPagedByCompanyAsync(
            int companyId, PaymentDirection direction, int page, int pageSize,
            string? search = null, int? contactId = null,
            DateTime? dateFrom = null, DateTime? dateTo = null)
        {
            var (items, total) = await _repo.GetPagedByCompanyAsync(
                companyId, direction, page, pageSize, search, contactId, dateFrom, dateTo);
            var names = await ResolveContactNamesAsync(items);
            var banks = await ResolveBankAccountsAsync(items);
            return new PagedResult<PaymentDto>
            {
                Items = items.Select(p => ToDto(p, names, banks)).ToList(),
                TotalCount = total,
                Page = page,
                PageSize = pageSize,
            };
        }

        public async Task<PaymentDto?> GetByIdAsync(int id)
        {
            var p = await _repo.GetByIdAsync(id);
            if (p == null) return null;
            var names = await ResolveContactNamesAsync(new[] { p });
            var banks = await ResolveBankAccountsAsync(new[] { p });
            return ToDto(p, names, banks);
        }

        public async Task<List<PaymentDto>> GetByInvoiceAsync(int companyId, int invoiceId)
        {
            var list = await _repo.GetByInvoiceAsync(companyId, invoiceId);
            var names = await ResolveContactNamesAsync(list);
            var banks = await ResolveBankAccountsAsync(list);
            return list.Select(p => ToDto(p, names, banks)).ToList();
        }

        public async Task<List<PaymentDto>> GetByPurchaseBillAsync(int companyId, int purchaseBillId)
        {
            var list = await _repo.GetByPurchaseBillAsync(companyId, purchaseBillId);
            var names = await ResolveContactNamesAsync(list);
            var banks = await ResolveBankAccountsAsync(list);
            return list.Select(p => ToDto(p, names, banks)).ToList();
        }

        // ── Create ───────────────────────────────────────────────────────────

        public async Task<PaymentDto> CreateAsync(int companyId, CreatePaymentDto dto)
        {
            var direction = ParseDirection(dto.Direction);
            // Canonicalise the contact type BEFORE anything branches on it, so
            // the belongs-to-this-company guard below and IsCustomerReceipt can
            // never disagree about what "Client" means.
            dto.ContactType = NormalizeContactType(dto.ContactType);

            AssertAllocationsPresent(direction, dto);

            // Shape + tax + direction validation, and fill in each line's Kind.
            // Runs BEFORE AssertAllocationsFitAmount so a bad LINE is reported as
            // such instead of as a bad document total.
            NormalizeAllocations(dto, direction);

            var invoiceIds = new List<int>();
            var billIds = new List<int>();
            var glEnabled = await _posting.IsEnabledAsync(companyId);
            var adjAccountIds = new HashSet<int>();
            foreach (var a in dto.Allocations)
            {
                if (a.AdjustmentAmount > 0)
                {
                    if (glEnabled && !a.AdjustmentAccountId.HasValue)
                        throw new InvalidOperationException("Choose the account the adjustment posts to (e.g. Discount allowed, Bad debts written off, or another account).");
                    if (a.AdjustmentAccountId.HasValue) adjAccountIds.Add(a.AdjustmentAccountId.Value);
                }

                if (a.InvoiceId.HasValue) invoiceIds.Add(a.InvoiceId.Value);
                if (a.PurchaseBillId.HasValue) billIds.Add(a.PurchaseBillId.Value);
            }
            // Every chosen adjustment account must belong to this company's CoA.
            if (adjAccountIds.Count > 0)
            {
                var valid = await _context.Accounts
                    .Where(x => x.CompanyId == companyId && adjAccountIds.Contains(x.Id))
                    .Select(x => x.Id).ToListAsync();
                if (adjAccountIds.Except(valid).Any())
                    throw new InvalidOperationException("The selected adjustment account doesn't belong to this company.");
            }

            AssertAllocationsFitAmount(dto, direction);

            // Period-close guard (GL lock date) before any writes.
            await _posting.AssertPeriodOpenAsync(companyId, dto.Date == default ? PakistanClock.Today : dto.Date);

            // Cross-tenant guard: every referenced document must belong to this
            // company (never trust the ids in the body — CLAUDE.md §1/§4).
            var invoices = await AssertInvoicesBelongToCompanyAsync(companyId, dto.Allocations);
            var bills = await _context.PurchaseBills
                .Where(b => billIds.Contains(b.Id)).ToListAsync();
            if (bills.Any(b => b.CompanyId != companyId) || bills.Count != billIds.Distinct().Count())
                throw new InvalidOperationException("One or more purchase bills do not belong to this company.");

            // Direct-line accounts must belong to this company too (the column
            // now carries a real FK; never trust body ids).
            await AssertAllocationAccountsAsync(companyId, dto);

            // Bank/cash account (the money's destination/source) must belong to
            // this company and be a BankCash account — never trust the id in the
            // body. Nullable: legacy/imported rows carry only a free-text name.
            string? bankAccountName = Trimmed(dto.BankAccountName);
            if (dto.BankAccountId.HasValue)
            {
                var bank = await _context.Accounts.AsNoTracking()
                    .FirstOrDefaultAsync(a => a.Id == dto.BankAccountId.Value && a.CompanyId == companyId);
                if (bank == null)
                    throw new InvalidOperationException("Bank/cash account does not belong to this company.");
                // Any company account is accepted (bank/cash accounts may be
                // plain asset accounts, e.g. migrated ones not flagged BankCash).
                // Snapshot the name so list views render without a join.
                bankAccountName = bank.Name;
            }

            // Optional Division tag must belong to this company when supplied.
            if (dto.DivisionId.HasValue &&
                !await _context.Divisions.AnyAsync(d => d.Id == dto.DivisionId.Value && d.CompanyId == companyId))
                throw new InvalidOperationException("Division does not belong to this company.");

            // Payee/payer: validate the type, resolve the name source, and drop a
            // stray id on an "Other" rather than leaving it half-linked. Runs
            // AFTER AssertAllocationsPresent so a line-less money-out still
            // reports the missing line rather than the missing party.
            var contact = NormalizeContact(dto);

            // Contact must belong to the company too, when one is named.
            if (contact.Id.HasValue)
            {
                if (contact.Type == "Client" &&
                    !await _context.Clients.AnyAsync(c => c.Id == contact.Id.Value && c.CompanyId == companyId))
                    throw new InvalidOperationException("Client does not belong to this company.");
                if (contact.Type == "Supplier" &&
                    !await _context.Suppliers.AnyAsync(s => s.Id == contact.Id.Value && s.CompanyId == companyId))
                    throw new InvalidOperationException("Supplier does not belong to this company.");
            }

            // Every settled document must belong to the named party.
            AssertDocumentsBelongToContact(contact, invoices, bills);

            // Over-allocation guard: a single document can't be paid beyond its
            // grand total. Sum this payment's lines per document, add to what's
            // already paid, and reject anything over the total. (Cap at the
            // COLLECTIBLE — GrandTotal − withheld — not GrandTotal: the withheld
            // slice is settled by the customer at invoice time, so only the
            // reduced balance can be received. See AssertNoInvoiceOverpayAsync.)
            await AssertNoInvoiceOverpayAsync(dto.Allocations, invoices);
            foreach (var grp in dto.Allocations.Where(a => a.PurchaseBillId.HasValue)
                         .GroupBy(a => a.PurchaseBillId!.Value))
            {
                var bill = bills.First(b => b.Id == grp.Key);
                var collectible = WithholdingTaxCalculator.Collectible(bill.GrandTotal, bill.WithholdingTaxAmount);
                var newTotal = bill.AmountPaid + grp.Sum(a => a.Amount + a.AdjustmentAmount);
                if (newTotal > collectible)
                    throw new InvalidOperationException(
                        $"Payment would over-pay Bill #{bill.PurchaseBillNumber} (balance due is {collectible - bill.AmountPaid:0.00}).");
            }

            // Division tag: when the caller didn't pick one, default from the
            // settled documents — a receipt against a single division's invoices
            // is that division's receipt. Only when unambiguous: mixed-division
            // or division-less documents leave the tag null. (Payment.cs promised
            // this default; it previously never happened.)
            var divisionId = dto.DivisionId;
            if (!divisionId.HasValue)
            {
                var docDivisions = invoices.Select(i => i.DivisionId)
                    .Concat(bills.Select(b => b.DivisionId))
                    .Distinct().ToList();
                if (docDivisions.Count == 1 && docDivisions[0].HasValue)
                    divisionId = docDivisions[0];
            }

            var paymentDate = dto.Date == default ? PakistanClock.Today : dto.Date;
            var payment = new Payment
            {
                CompanyId = companyId,
                Direction = direction,
                Date = paymentDate,
                // Cleared-by-default (Manager-style): a new receipt/payment is
                // reconciled as of its own date; "pending" is the opt-in exception.
                ReconciledDate = paymentDate,
                ContactType = contact.Type,
                ContactId = contact.Id,
                ContactName = contact.Name,
                DivisionId = divisionId,
                BankAccountId = dto.BankAccountId,
                BankAccountName = bankAccountName,
                Method = string.IsNullOrWhiteSpace(dto.Method) ? "Cash" : dto.Method.Trim(),
                Description = Trimmed(dto.Description),
                Amount = ResolveAmount(dto, direction),
                ChequeNumber = Trimmed(dto.ChequeNumber),
                ChequeDate = dto.ChequeDate,
                ChequeStatus = ParseChequeStatus(dto.ChequeStatus, dto.ChequeNumber),
                Allocations = dto.Allocations.Select(a => new PaymentAllocation
                {
                    Kind = ParseAllocationKind(a.Kind) ?? AllocationKind.Document,
                    InvoiceId = a.InvoiceId,
                    PurchaseBillId = a.PurchaseBillId,
                    AccountId = a.AccountId,
                    Amount = a.Amount,
                    TaxRate = a.TaxRate,
                    TaxAmount = a.TaxAmount ?? 0m,
                    AdjustmentAmount = a.AdjustmentAmount,
                    AdjustmentAccountId = a.AdjustmentAmount > 0 ? a.AdjustmentAccountId : null,
                }).ToList(),
            };

            await using var tx = await _context.Database.BeginTransactionAsync();
            try
            {
                _context.Payments.Add(payment);

                // Allocate the per-(company, direction) number; the loser of a
                // concurrent create retries on the unique-index violation.
                await NumberAllocationRetry.ExecuteAsync(async _ =>
                {
                    if (dto.Number.HasValue && dto.Number.Value > 0)
                    {
                        payment.Number = dto.Number.Value; // import path — fixed number
                    }
                    else
                    {
                        var max = await _repo.GetMaxNumberAsync(companyId, direction);
                        payment.Number = max + 1;
                    }
                    await _context.SaveChangesAsync();
                    return payment.Id;
                });

                // Reflow paid totals on the touched documents.
                foreach (var id in invoiceIds.Distinct()) await RecomputeInvoiceAsync(id);
                foreach (var id in billIds.Distinct()) await RecomputePurchaseBillAsync(id);
                await _context.SaveChangesAsync();

                // GL posting (no-op unless the company enabled it) — same tx,
                // so the document and its ledger entry commit or roll back together.
                await _posting.PostPaymentAsync(payment);

                await tx.CommitAsync();
            }
            catch
            {
                await tx.RollbackAsync();
                throw;
            }

            return (await GetByIdAsync(payment.Id))!;
        }

        // ── Update (full edit) ─────────────────────────────────────────────────

        public async Task<PaymentDto?> UpdateAsync(int id, CreatePaymentDto dto)
        {
            var payment = await _repo.GetByIdAsync(id);   // tracked, incl. allocations
            if (payment == null) return null;
            var companyId = payment.CompanyId;
            var direction = payment.Direction;            // direction is immutable on edit
            // Canonical before any branch reads it — see CreateAsync.
            dto.ContactType = NormalizeContactType(dto.ContactType);

            // Same rules as the create path — an edit must not be able to make a
            // document a create could not have made, nor silently drop the cash
            // of one it could. The contact CAN change on an edit, so the
            // customer-receipt test reads the INCOMING dto, not the stored row.
            AssertAllocationsPresent(direction, dto);

            // Period-close guard: the payment can't move out of OR into a
            // locked period, so check both the stored and the incoming date.
            await _posting.AssertPeriodOpenAsync(companyId, payment.Date);
            if (dto.Date != default)
                await _posting.AssertPeriodOpenAsync(companyId, dto.Date);

            NormalizeAllocations(dto, direction);

            var invoiceIds = new List<int>();
            var billIds = new List<int>();
            foreach (var a in dto.Allocations)
            {
                if (a.InvoiceId.HasValue) invoiceIds.Add(a.InvoiceId.Value);
                if (a.PurchaseBillId.HasValue) billIds.Add(a.PurchaseBillId.Value);
            }
            AssertAllocationsFitAmount(dto, direction);
            await AssertAllocationAccountsAsync(companyId, dto);

            var invoices = await AssertInvoicesBelongToCompanyAsync(companyId, dto.Allocations);
            var bills = await _context.PurchaseBills.Where(b => billIds.Contains(b.Id)).ToListAsync();
            if (bills.Any(b => b.CompanyId != companyId) || bills.Count != billIds.Distinct().Count())
                throw new InvalidOperationException("One or more purchase bills do not belong to this company.");

            if (dto.DivisionId.HasValue &&
                !await _context.Divisions.AnyAsync(d => d.Id == dto.DivisionId.Value && d.CompanyId == companyId))
                throw new InvalidOperationException("Division does not belong to this company.");

            string? bankAccountName = Trimmed(dto.BankAccountName);
            if (dto.BankAccountId.HasValue)
            {
                var bank = await _context.Accounts.AsNoTracking()
                    .FirstOrDefaultAsync(a => a.Id == dto.BankAccountId.Value && a.CompanyId == companyId);
                if (bank == null)
                    throw new InvalidOperationException("Bank/cash account does not belong to this company.");
                bankAccountName = bank.Name;
            }

            var contact = NormalizeContact(dto);
            if (contact.Id.HasValue)
            {
                if (contact.Type == "Client" &&
                    !await _context.Clients.AnyAsync(c => c.Id == contact.Id.Value && c.CompanyId == companyId))
                    throw new InvalidOperationException("Client does not belong to this company.");
                if (contact.Type == "Supplier" &&
                    !await _context.Suppliers.AnyAsync(s => s.Id == contact.Id.Value && s.CompanyId == companyId))
                    throw new InvalidOperationException("Supplier does not belong to this company.");
            }

            // On an edit, a mismatch this payment already had stays allowed; a NEW
            // one is rejected. Keeps legacy cross-party receipts editable.
            AssertDocumentsBelongToContact(contact, invoices, bills, (
                payment.Allocations.Where(a => a.InvoiceId.HasValue).Select(a => a.InvoiceId!.Value).ToHashSet(),
                payment.Allocations.Where(a => a.PurchaseBillId.HasValue).Select(a => a.PurchaseBillId!.Value).ToHashSet()));

            // Over-allocation guard, EXCLUDING this payment's own current lines
            // (we're replacing them), so editing down/up stays within the total.
            await AssertNoInvoiceOverpayAsync(dto.Allocations, invoices, excludePaymentId: id);
            foreach (var grp in dto.Allocations.Where(a => a.PurchaseBillId.HasValue).GroupBy(a => a.PurchaseBillId!.Value))
            {
                var bill = bills.First(b => b.Id == grp.Key);
                var collectible = WithholdingTaxCalculator.Collectible(bill.GrandTotal, bill.WithholdingTaxAmount);
                var paidByOthers = await _context.PaymentAllocations
                    .Where(pa => pa.PurchaseBillId == grp.Key && pa.PaymentId != id && !pa.Payment.IsCancelled)
                    .SumAsync(pa => (decimal?)(pa.Amount + pa.AdjustmentAmount)) ?? 0m;
                if (paidByOthers + grp.Sum(a => a.Amount + a.AdjustmentAmount) > collectible)
                    throw new InvalidOperationException(
                        $"Payment would over-pay Bill #{bill.PurchaseBillNumber} (available is {collectible - paidByOthers:0.00}).");
            }

            // Documents this payment used to touch — reflow them too even if the
            // edit dropped them.
            var oldInvoiceIds = payment.Allocations.Where(a => a.InvoiceId.HasValue).Select(a => a.InvoiceId!.Value).Distinct().ToList();
            var oldBillIds = payment.Allocations.Where(a => a.PurchaseBillId.HasValue).Select(a => a.PurchaseBillId!.Value).Distinct().ToList();

            await using var tx = await _context.Database.BeginTransactionAsync();
            try
            {
                payment.Date = dto.Date == default ? payment.Date : dto.Date;
                payment.ContactType = contact.Type;
                payment.ContactId = contact.Id;
                payment.ContactName = contact.Name;
                payment.DivisionId = dto.DivisionId;
                payment.BankAccountId = dto.BankAccountId;
                payment.BankAccountName = bankAccountName;
                payment.Method = string.IsNullOrWhiteSpace(dto.Method) ? "Cash" : dto.Method.Trim();
                payment.Description = Trimmed(dto.Description);
                payment.ChequeNumber = Trimmed(dto.ChequeNumber);
                payment.ChequeDate = dto.ChequeDate;
                payment.ChequeStatus = ParseChequeStatus(dto.ChequeStatus, dto.ChequeNumber);
                payment.Amount = ResolveAmount(dto, direction);

                // Replace allocation lines.
                _context.PaymentAllocations.RemoveRange(payment.Allocations);
                await _context.SaveChangesAsync();
                _context.PaymentAllocations.AddRange(dto.Allocations.Select(a => new PaymentAllocation
                {
                    PaymentId = payment.Id,
                    Kind = ParseAllocationKind(a.Kind) ?? AllocationKind.Document,
                    InvoiceId = a.InvoiceId,
                    PurchaseBillId = a.PurchaseBillId,
                    AccountId = a.AccountId,
                    Amount = a.Amount,
                    TaxRate = a.TaxRate,
                    TaxAmount = a.TaxAmount ?? 0m,
                    AdjustmentAmount = a.AdjustmentAmount,
                    AdjustmentAccountId = a.AdjustmentAmount > 0 ? a.AdjustmentAccountId : null,
                }));
                await _context.SaveChangesAsync();

                foreach (var iid in oldInvoiceIds.Union(invoiceIds).Distinct()) await RecomputeInvoiceAsync(iid);
                foreach (var bid in oldBillIds.Union(billIds).Distinct()) await RecomputePurchaseBillAsync(bid);
                await _context.SaveChangesAsync();

                // Re-post: the engine replaces this payment's journal entry so
                // the ledger mirrors the edited allocations/date/bank account.
                await _posting.PostPaymentAsync(payment);

                await tx.CommitAsync();
            }
            catch
            {
                await tx.RollbackAsync();
                throw;
            }

            return await GetByIdAsync(payment.Id);
        }

        // ── Allocate (advance -> invoice) ───────────────────────────────────────

        /// <summary>Apply part of a receipt's unallocated balance to invoices.
        /// Reuses the create-path guards: each invoice must belong to the same
        /// company, must not be over-paid, and the new lines plus the existing
        /// ones may not exceed the receipt amount.</summary>
        public async Task<PaymentDto?> AllocateAsync(int paymentId, List<CreatePaymentAllocationDto> lines)
        {
            var payment = await _repo.GetByIdAsync(paymentId);   // tracked, incl. allocations
            if (payment == null) return null;
            if (payment.Direction != PaymentDirection.Receipt)
                throw new InvalidOperationException("Only a receipt can be allocated to invoices.");
            if (payment.IsCancelled)
                throw new InvalidOperationException("A cancelled receipt cannot be allocated.");
            if (lines == null || lines.Count == 0)
                throw new InvalidOperationException("Choose at least one invoice to allocate to.");
            // Every line must target exactly one invoice — never a bill or a
            // direct account (an advance is a Client's money; there is nothing
            // else to allocate it to). Same "exactly one target" shape rule as
            // Create/Update, narrowed to the one target Allocate accepts.
            if (lines.Any(l => !l.InvoiceId.HasValue || l.PurchaseBillId.HasValue || l.AccountId.HasValue))
                throw new InvalidOperationException("A receipt allocation must target a sales invoice.");
            if (lines.Any(l => l.Amount < 0 || l.AdjustmentAmount < 0))
                throw new InvalidOperationException("Allocation amounts cannot be negative.");
            if (lines.Any(l => l.Amount + l.AdjustmentAmount <= 0))
                throw new InvalidOperationException("Each allocation must apply a positive amount (cash and/or adjustment).");
            // Every line here settles a document, whose own tax was posted when it
            // was raised — same rule NormalizeAllocations applies to a Document
            // line, stated explicitly so tax sent here is refused rather than
            // silently dropped on the way to PaymentAllocation.
            if (lines.Any(l => (l.TaxAmount ?? 0m) != 0m || (l.TaxRate ?? 0m) != 0m))
                throw new InvalidOperationException("Tax belongs on the invoice or bill, not on the payment that settles it.");

            // CASH only against the RECEIPT — see Global Constraints / the
            // module docstring in test_customer_receipts_ledger.py.
            // AdjustmentAmount is a non-cash write-off that settles the INVOICE,
            // not the receipt, so it plays no part in "how much of this receipt
            // is still unallocated" (using the settlement figure here would
            // wrongly reject a legitimate allocation that carries a write-off).
            var appliedCash = payment.Allocations.Sum(a => a.Amount);
            var addingCash = lines.Sum(l => l.Amount);
            if (appliedCash + addingCash > payment.Amount)
                throw new InvalidOperationException(
                    $"Only {payment.Amount - appliedCash:0.00} of this receipt is unallocated.");

            // A settle-remainder adjustment needs a GL account (when the ledger
            // is on), and that account must belong to this company — the same
            // rule CreateAsync applies to its own adjustment lines.
            var glEnabled = await _posting.IsEnabledAsync(payment.CompanyId);
            var adjAccountIds = new HashSet<int>();
            foreach (var l in lines)
            {
                if (l.AdjustmentAmount > 0)
                {
                    if (glEnabled && !l.AdjustmentAccountId.HasValue)
                        throw new InvalidOperationException("Choose the account the adjustment posts to (e.g. Discount allowed, Bad debts written off, or another account).");
                    if (l.AdjustmentAccountId.HasValue) adjAccountIds.Add(l.AdjustmentAccountId.Value);
                }
            }
            if (adjAccountIds.Count > 0)
            {
                var validAdjAccounts = await _context.Accounts
                    .Where(x => x.CompanyId == payment.CompanyId && adjAccountIds.Contains(x.Id))
                    .Select(x => x.Id).ToListAsync();
                if (adjAccountIds.Except(validAdjAccounts).Any())
                    throw new InvalidOperationException("The selected adjustment account doesn't belong to this company.");
            }

            // Period-close guard before any writes — Allocate is a GL-affecting
            // mutation on an EXISTING document (IPostingService.AssertPeriodOpenAsync:
            // "Document services call this before any GL-affecting mutation"),
            // exactly like Delete guards the stored Date before it removes one.
            await _posting.AssertPeriodOpenAsync(payment.CompanyId, payment.Date);

            // Same company, and no invoice pushed past its balance — shared with
            // Create/Update rather than a third copy of either guard.
            var invoices = await AssertInvoicesBelongToCompanyAsync(payment.CompanyId, lines);

            // And the same cross-party rule, read from the STORED contact because
            // an allocate body carries no party of its own. Without it this
            // endpoint would be a way round the guard the create and edit paths
            // apply: the receipt's A/R credit is tagged to ITS client, so applying
            // it to another client's invoice would leave that invoice settled
            // against the wrong subledger. Documents this receipt already settles
            // are grandfathered, exactly as on the edit path.
            AssertDocumentsBelongToContact(
                (NormalizeContactType(payment.ContactType), payment.ContactId, null),
                invoices, new List<PurchaseBill>(),
                (payment.Allocations.Where(a => a.InvoiceId.HasValue)
                     .Select(a => a.InvoiceId!.Value).ToHashSet(),
                 new HashSet<int>()));

            await AssertNoInvoiceOverpayAsync(lines, invoices);

            await using var tx = await _context.Database.BeginTransactionAsync();
            try
            {
                foreach (var l in lines)
                    payment.Allocations.Add(new PaymentAllocation
                    {
                        PaymentId = payment.Id,
                        InvoiceId = l.InvoiceId,
                        Amount = l.Amount,
                        AdjustmentAmount = l.AdjustmentAmount,
                        AdjustmentAccountId = l.AdjustmentAmount > 0 ? l.AdjustmentAccountId : null,
                    });
                await _context.SaveChangesAsync();

                foreach (var invId in lines.Select(l => l.InvoiceId!.Value).Distinct())
                    await RecomputeInvoiceAsync(invId);
                await _context.SaveChangesAsync();

                // Re-post: the advance leg shrinks by exactly what A/R gains.
                await _posting.PostPaymentAsync(payment);
                await tx.CommitAsync();
            }
            catch
            {
                await tx.RollbackAsync();
                throw;
            }

            return await GetByIdAsync(payment.Id);
        }

        // ── Delete ───────────────────────────────────────────────────────────

        public async Task<bool> DeleteAsync(int id)
        {
            var payment = await _repo.GetByIdAsync(id);
            if (payment == null) return false;

            // Period-close guard: a locked payment can't be deleted either.
            await _posting.AssertPeriodOpenAsync(payment.CompanyId, payment.Date);

            // Capture the documents this payment touched BEFORE the cascade
            // removes the allocation rows, so we can reflow their paid totals.
            var invoiceIds = payment.Allocations.Where(a => a.InvoiceId.HasValue)
                .Select(a => a.InvoiceId!.Value).Distinct().ToList();
            var billIds = payment.Allocations.Where(a => a.PurchaseBillId.HasValue)
                .Select(a => a.PurchaseBillId!.Value).Distinct().ToList();

            await using var tx = await _context.Database.BeginTransactionAsync();
            try
            {
                // The ledger entry dies with its document.
                await _posting.RemoveForSourceAsync(payment.CompanyId,
                    Models.Accounting.SourceDocType.Payment, payment.Id);

                _context.Payments.Remove(payment); // allocations cascade
                await _context.SaveChangesAsync();

                foreach (var iid in invoiceIds) await RecomputeInvoiceAsync(iid);
                foreach (var bid in billIds) await RecomputePurchaseBillAsync(bid);
                await _context.SaveChangesAsync();

                await tx.CommitAsync();
            }
            catch
            {
                await tx.RollbackAsync();
                throw;
            }
            return true;
        }

        // ── Cheque lifecycle ──────────────────────────────────────────────────

        public async Task<PaymentDto?> SetChequeStatusAsync(int id, string status)
        {
            var payment = await _repo.GetByIdAsync(id);
            if (payment == null) return null;

            if (string.IsNullOrWhiteSpace(payment.ChequeNumber) && payment.ChequeStatus == ChequeStatus.None)
                throw new InvalidOperationException("This document is not a cheque payment.");
            if (!Enum.TryParse<ChequeStatus>(status, true, out var parsed) || parsed == ChequeStatus.None)
                throw new InvalidOperationException("Cheque status must be Pending, Deposited, Cleared or Bounced.");

            payment.ChequeStatus = parsed;
            await _context.SaveChangesAsync();
            return await GetByIdAsync(id);
        }

        // ── Amount / allocation rules (shared by create and edit) ─────────────

        /// <summary>Canonical contact type — "Client", "Supplier", "Other" for a
        /// blank, otherwise the trimmed value as given.
        ///
        /// Every branch on ContactType in this file, and PostingService's party
        /// tag, compares ORDINALLY against "Client"/"Supplier". Folding the
        /// incoming value once, before anything reads it, is what keeps them all
        /// agreeing. They previously did not: a body sending "client" made
        /// IsCustomerReceipt say yes (so allocations became optional) while the
        /// belongs-to-this-company guard said no and never ran, and a line-less
        /// receipt — which has no allocated invoice to be company-checked in its
        /// place — could then persist a ContactId owned by another tenant.</summary>
        private static string NormalizeContactType(string? s)
        {
            var t = s?.Trim();
            if (string.IsNullOrEmpty(t)) return "Other";
            if (string.Equals(t, "Client", StringComparison.OrdinalIgnoreCase)) return "Client";
            if (string.Equals(t, "Supplier", StringComparison.OrdinalIgnoreCase)) return "Supplier";
            if (string.Equals(t, "Other", StringComparison.OrdinalIgnoreCase)) return "Other";
            // Deliberately non-throwing: this also runs on READ paths over values
            // already stored. NormalizeContact is what refuses an unknown type on
            // the way IN.
            return t;
        }

        /// <summary>A receipt taken from a named customer — the only document
        /// whose unapplied balance has somewhere to live (the client's own
        /// Accounts receivable, see PostingService.PostPaymentAsync). Money-out
        /// and party-less "Other" receipts have no party to hold it, so they
        /// still need at least one allocation line.</summary>
        private static bool IsCustomerReceipt(PaymentDirection direction, CreatePaymentDto dto) =>
            direction == PaymentDirection.Receipt
            && NormalizeContactType(dto.ContactType) == "Client"
            && dto.ContactId.HasValue;

        /// <summary>Enforce the allocation requirement and normalise the list so
        /// the rest of the pipeline can treat it as non-null.</summary>
        private static void AssertAllocationsPresent(PaymentDirection direction, CreatePaymentDto dto)
        {
            if ((dto.Allocations == null || dto.Allocations.Count == 0) && !IsCustomerReceipt(direction, dto))
                throw new InvalidOperationException("A payment needs at least one allocation line.");
            dto.Allocations ??= new List<CreatePaymentAllocationDto>();
        }

        /// <summary>Cash total of the document. For a RECEIPT, explicit when
        /// supplied — that's the whole point of the 2026-08-29 change: an
        /// advance can exceed Σ allocations. For a PAYMENT (money-out), there is
        /// no "advance to supplier" concept yet, so the override is ignored and
        /// Amount is always derived — byte-for-byte the same stored value every
        /// pre-2026-08-29 caller got, no matter what a caller now sends in
        /// dto.Amount. (Without this gate, PostingService silently plugs the
        /// uncovered remainder of a money-out payment to Suspense — an ungated
        /// new capability nothing asked for and nothing tests.)</summary>
        private static decimal ResolveAmount(CreatePaymentDto dto, PaymentDirection direction) =>
            direction == PaymentDirection.Payment
                ? dto.Allocations.Sum(a => a.Amount)
                : dto.Amount ?? dto.Allocations.Sum(a => a.Amount);

        /// <summary>Allocations may spend part of the document's CASH, but never
        /// more than it — the difference is the advance (Receipt only — see
        /// ResolveAmount), and it cannot be negative. AdjustmentAmount is
        /// deliberately absent: it is a non-cash write-off, so a 1000 receipt
        /// may legitimately clear an 1100 invoice as 1000 cash + 100 written off.</summary>
        private static void AssertAllocationsFitAmount(CreatePaymentDto dto, PaymentDirection direction)
        {
            var amount = ResolveAmount(dto, direction);
            var appliedCash = dto.Allocations.Sum(a => a.Amount);
            // Sign first: a negative amount would otherwise be reported as an
            // over-allocation ("0.00 is more than -5000.00"), which reads as
            // nonsense to the operator.
            if (amount < 0m)
                throw new InvalidOperationException("A receipt must be for a positive amount.");
            if (appliedCash > amount)
                throw new InvalidOperationException(
                    $"Allocations apply {appliedCash:0.00} in cash, which is more than the receipt amount {amount:0.00}.");
            // Only a LINE-LESS document is required to carry cash — with no
            // lines and no cash it records nothing at all. A zero-cash document
            // WITH lines is the pure write-off the settle-remainder feature
            // already ships (cash 0 + AdjustmentAmount > 0): no money moves, the
            // invoice clears from the adjustment account, and it is accepted on
            // BOTH directions today — so money-out stays byte-for-byte the same.
            if (amount == 0m && dto.Allocations.Count == 0)
                throw new InvalidOperationException("A receipt must be for a positive amount.");
        }

        /// <summary>Direct-line allocation accounts (PaymentAllocation.AccountId)
        /// must be active accounts of THIS company — the ids come from the
        /// request body and now carry a real FK — and must not be control
        /// accounts.</summary>
        private async Task AssertAllocationAccountsAsync(int companyId, CreatePaymentDto dto)
        {
            var accountIds = dto.Allocations!
                .Where(a => a.AccountId.HasValue)
                .Select(a => a.AccountId!.Value).Distinct().ToList();
            if (accountIds.Count == 0) return;
            var rows = await _context.Accounts.AsNoTracking()
                .Where(a => accountIds.Contains(a.Id) && a.CompanyId == companyId && a.IsActive)
                .Select(a => new { a.Id, a.Name, a.IsControlAccount, a.ControlType })
                .ToListAsync();
            if (rows.Count != accountIds.Count)
                throw new InvalidOperationException("One or more allocation accounts do not belong to this company.");

            // A subledger-maintained control account is fed by its own subledger
            // (Accounts receivable by receipts, Accounts payable by payments, Bank
            // & Cash by the bank register, Inventory by stock movements…). Posting
            // an expense straight at one would double-count and silently corrupt
            // that party's, bank's or stock's balance — Account.cs says as much.
            // The legitimate route to AR/AP is an "OnAccount" line, which carries
            // the party with it.
            var control = rows.FirstOrDefault(r => r.IsControlAccount && !OperatorPickable(r.ControlType));
            if (control != null)
                throw new InvalidOperationException(
                    $"\"{control.Name}\" is a control account maintained by the system, so it can't be chosen here. " +
                    "For an advance, set the line to \"Advance / on account\" instead; otherwise pick an income or expense account.");
        }

        /// <summary>Control ROLES that are nonetheless ordinary accounts an operator
        /// posts to by hand, so the guard above must not refuse them:
        /// <list type="bullet">
        ///   <item>the settle-remainder quick-picks (Discount allowed/received, Bad
        ///   debts, Write-back) — plain P&amp;L accounts that carry a role only so the
        ///   receipt/payment form can offer them first, and which this same service
        ///   already accepts as AdjustmentAccountId;</item>
        ///   <item>Owner's capital — "the owner put money in" is a receipt straight
        ///   to capital, and Drawings is its plain-account counterpart;</item>
        ///   <item>Rounding — a P&amp;L difference bucket, not a subledger.</item>
        /// </list>
        /// Everything else flagged IsControlAccount is fed by a subledger the
        /// system maintains and is off limits.</summary>
        private static bool OperatorPickable(ControlType t) => t is
            ControlType.DiscountAllowed or ControlType.DiscountReceived or
            ControlType.BadDebtWriteOff or ControlType.WriteBackIncome or
            ControlType.Capital or ControlType.Rounding;

        /// <summary>
        /// Put the allocation lines into canonical form and reject impossible ones,
        /// BEFORE any database work. Shared by create and update so both agree —
        /// an edit must not be able to make a document a create could not have made.
        ///
        /// Fills in <c>Kind</c> when the caller didn't send it (inferred from which
        /// id is set, which keeps the ETL importer and older clients working), and
        /// derives the tax slice from a rate so the UI can send either.
        /// </summary>
        private static void NormalizeAllocations(CreatePaymentDto dto, PaymentDirection direction)
        {
            var isReceipt = direction == PaymentDirection.Receipt;
            var contactType = NormalizeContactType(dto.ContactType);

            foreach (var a in dto.Allocations!)
            {
                var kind = ParseAllocationKind(a.Kind)
                    ?? (a.InvoiceId.HasValue || a.PurchaseBillId.HasValue ? AllocationKind.Document
                        : a.AccountId.HasValue ? AllocationKind.Account
                        : AllocationKind.OnAccount);
                a.Kind = kind.ToString();

                if (a.Amount < 0 || a.AdjustmentAmount < 0)
                    throw new InvalidOperationException("Amounts cannot be negative.");

                switch (kind)
                {
                    case AllocationKind.Document:
                        if (!a.InvoiceId.HasValue && !a.PurchaseBillId.HasValue)
                            throw new InvalidOperationException("Choose the invoice or bill this line settles.");
                        if (a.InvoiceId.HasValue && a.PurchaseBillId.HasValue)
                            throw new InvalidOperationException("A line can settle one document, not both.");
                        if (a.AccountId.HasValue)
                            throw new InvalidOperationException("A line that settles an invoice or bill can't also pick an account.");
                        // The document's own tax was posted when it was raised.
                        if ((a.TaxAmount ?? 0m) != 0m || (a.TaxRate ?? 0m) != 0m)
                            throw new InvalidOperationException("Tax belongs on the invoice or bill, not on the payment that settles it.");
                        break;

                    case AllocationKind.Account:
                        if (!a.AccountId.HasValue)
                            throw new InvalidOperationException("Choose what this line was for (an income or expense account).");
                        if (a.InvoiceId.HasValue || a.PurchaseBillId.HasValue)
                            throw new InvalidOperationException("An income/expense line can't also settle a document.");
                        if (a.AdjustmentAmount > 0)
                            throw new InvalidOperationException("Writing off a difference only applies to a line that settles an invoice or bill.");
                        NormalizeLineTax(a);
                        break;

                    case AllocationKind.OnAccount:
                        if (a.InvoiceId.HasValue || a.PurchaseBillId.HasValue || a.AccountId.HasValue)
                            throw new InvalidOperationException("An advance line has no document and no account — it sits against the party's balance.");
                        if (a.AdjustmentAmount > 0)
                            throw new InvalidOperationException("Writing off a difference only applies to a line that settles an invoice or bill.");
                        if ((a.TaxAmount ?? 0m) != 0m || (a.TaxRate ?? 0m) != 0m)
                            throw new InvalidOperationException("An advance carries no tax — the tax is recorded on the invoice or bill it is later applied to.");
                        // A client sits in receivables, a supplier in payables — an
                        // "Other" payee has neither, so there is nowhere to hold the
                        // advance and it must be recorded as income/expense instead.
                        if (contactType != "Client" && contactType != "Supplier")
                            throw new InvalidOperationException(
                                isReceipt ? "An advance has to come from a client or a supplier — choose one, or record it as income instead."
                                          : "An advance has to go to a client or a supplier — choose one, or record it as an expense instead.");
                        if (!dto.ContactId.HasValue)
                            throw new InvalidOperationException("Choose the client or supplier this advance belongs to.");
                        break;
                }

                if (a.Amount + a.AdjustmentAmount <= 0)
                    throw new InvalidOperationException("Each line must apply a positive amount.");

                if (kind != AllocationKind.Document && a.AdjustmentAccountId.HasValue)
                    a.AdjustmentAccountId = null;   // only a settled document can carry the write-off
            }

            // Direction guards — unchanged rules, kept here so every caller gets them.
            foreach (var a in dto.Allocations!)
            {
                if (isReceipt && a.PurchaseBillId.HasValue)
                    throw new InvalidOperationException("A receipt cannot settle a purchase bill.");
                if (!isReceipt && a.InvoiceId.HasValue)
                    throw new InvalidOperationException("A payment cannot settle a sales invoice.");
            }
        }

        /// <summary>Resolve a line's tax: an explicit amount wins, otherwise derive
        /// it from the rate as the slice already inside the gross Amount (the same
        /// tax-inclusive convention the invoice/bill totals use).</summary>
        private static void NormalizeLineTax(CreatePaymentAllocationDto a)
        {
            var rate = a.TaxRate ?? 0m;
            if (rate < 0m || rate > 100m)
                throw new InvalidOperationException("Tax rate must be between 0 and 100.");

            if (a.TaxAmount.HasValue)
            {
                if (a.TaxAmount.Value < 0m)
                    throw new InvalidOperationException("Tax cannot be negative.");
            }
            else if (rate > 0m)
            {
                a.TaxAmount = Math.Round(a.Amount * rate / (100m + rate), 2, MidpointRounding.AwayFromZero);
            }

            var tax = a.TaxAmount ?? 0m;
            if (tax > a.Amount)
                throw new InvalidOperationException("Tax cannot be more than the amount of the line.");
            a.TaxAmount = tax;
            if (rate == 0m && tax == 0m) a.TaxRate = null;
        }

        private static AllocationKind? ParseAllocationKind(string? raw) =>
            string.IsNullOrWhiteSpace(raw) ? null
            : Enum.TryParse<AllocationKind>(raw.Trim(), ignoreCase: true, out var k) ? k
            : throw new InvalidOperationException($"Unknown line type \"{raw}\".");

        /// <summary>
        /// The party named on the header must be the party who owns every document
        /// being settled. Without this a payment could name Supplier A and clear
        /// Supplier B's bill — the cash and the balance would both be right, but the
        /// journal line would be tagged to the wrong supplier and their ledger would
        /// be wrong for good.
        ///
        /// A party-less payee ("Other") is exempt by design: settling someone
        /// else's invoice from an unnamed receipt is a supported shape, and
        /// CustomerLedgerService carries those allocations onto the invoice
        /// owner's trail (its de-duplication rule).
        ///
        /// <paramref name="grandfathered"/> exempts documents this payment was
        /// ALREADY settling. Migrated data carries receipt lines whose invoice
        /// belongs to a different client (a legacy grouping habit); enforcing on
        /// them would make those records permanently uneditable, so an edit may
        /// keep an existing mismatch while never introducing a new one.
        /// </summary>
        private static void AssertDocumentsBelongToContact(
            (string Type, int? Id, string? Name) contact,
            List<Invoice> invoices, List<PurchaseBill> bills,
            (HashSet<int> Invoices, HashSet<int> Bills)? grandfathered = null)
        {
            if (!contact.Id.HasValue) return;

            if (contact.Type == "Client")
            {
                var wrong = invoices.FirstOrDefault(i => i.ClientId != contact.Id.Value
                    && !(grandfathered?.Invoices.Contains(i.Id) ?? false));
                if (wrong != null)
                    throw new InvalidOperationException(
                        $"Invoice #{wrong.InvoiceNumber} belongs to a different client. Record a separate receipt for it.");
            }
            else if (contact.Type == "Supplier")
            {
                var wrong = bills.FirstOrDefault(b => b.SupplierId != contact.Id.Value
                    && !(grandfathered?.Bills.Contains(b.Id) ?? false));
                if (wrong != null)
                    throw new InvalidOperationException(
                        $"Bill #{wrong.PurchaseBillNumber} belongs to a different supplier. Record a separate payment for it.");
            }
        }

        /// <summary>Normalise the payee/payer: a Client/Supplier gets its name from
        /// the FK (so it can't drift), an "Other" keeps the typed name, and a stray
        /// ContactId on an "Other" is dropped rather than half-linked.
        ///
        /// The type is canonicalised first (see <see cref="NormalizeContactType"/>),
        /// so "client"/" Client " and "Client" mean the same thing here as they do
        /// to every other branch in this file; anything that is still not one of the
        /// three known types is rejected rather than stored.</summary>
        private static (string Type, int? Id, string? Name) NormalizeContact(CreatePaymentDto dto)
        {
            var type = NormalizeContactType(dto.ContactType);
            if (type != "Client" && type != "Supplier" && type != "Other")
                throw new InvalidOperationException($"Unknown payee type \"{type}\".");

            if (type == "Other")
                return (type, null, Trimmed(dto.ContactName));

            if (!dto.ContactId.HasValue)
                throw new InvalidOperationException(
                    type == "Client" ? "Choose the client." : "Choose the supplier.");
            return (type, dto.ContactId, null);
        }

        /// <summary>Cross-tenant guard: every invoice an allocation line targets
        /// must belong to this company (never trust ids in the body — CLAUDE.md
        /// §1/§4). Shared by Create, Update and Allocate — was three near-copies
        /// of the same invoice half of this check. Returns the loaded invoices
        /// so callers don't reload them for the over-pay guard below.</summary>
        private async Task<List<Invoice>> AssertInvoicesBelongToCompanyAsync(
            int companyId, IEnumerable<CreatePaymentAllocationDto> lines)
        {
            var invoiceIds = lines.Where(a => a.InvoiceId.HasValue)
                .Select(a => a.InvoiceId!.Value).Distinct().ToList();
            var invoices = await _context.Invoices.Where(i => invoiceIds.Contains(i.Id)).ToListAsync();
            if (invoices.Any(i => i.CompanyId != companyId) || invoices.Count != invoiceIds.Count)
                throw new InvalidOperationException("One or more invoices do not belong to this company.");
            return invoices;
        }

        /// <summary>Per-invoice over-pay guard: an invoice's cash+adjustment
        /// settled total may never exceed its COLLECTIBLE cap (GrandTotal −
        /// withheld — the withheld slice is settled by the customer at invoice
        /// time, so only the reduced balance can be received).
        ///
        /// Create and Allocate only ADD allocation lines, so "already paid" is
        /// simply the invoice's current AmountPaid. Update REPLACES this
        /// payment's own prior lines (delete-then-reinsert), so it passes
        /// excludePaymentId to recompute what every OTHER payment settled —
        /// otherwise this payment's own old contribution would be double-counted
        /// against its own replacement lines.
        ///
        /// Wording matches each original call site exactly — a refactor, not a
        /// redesign: "balance due" when adding fresh (Create/Allocate),
        /// "available" when excluding self (Update).</summary>
        private async Task AssertNoInvoiceOverpayAsync(
            IEnumerable<CreatePaymentAllocationDto> lines, IReadOnlyCollection<Invoice> invoices,
            int? excludePaymentId = null)
        {
            foreach (var grp in lines.Where(a => a.InvoiceId.HasValue).GroupBy(a => a.InvoiceId!.Value))
            {
                var inv = invoices.First(i => i.Id == grp.Key);
                var collectible = WithholdingTaxCalculator.Collectible(inv.GrandTotal, inv.WithholdingTaxAmount);
                var alreadyPaid = inv.AmountPaid;
                if (excludePaymentId.HasValue)
                {
                    alreadyPaid = await _context.PaymentAllocations
                        .Where(pa => pa.InvoiceId == grp.Key && pa.PaymentId != excludePaymentId.Value && !pa.Payment.IsCancelled)
                        .SumAsync(pa => (decimal?)(pa.Amount + pa.AdjustmentAmount)) ?? 0m;
                }
                if (alreadyPaid + grp.Sum(a => a.Amount + a.AdjustmentAmount) > collectible)
                {
                    var label = excludePaymentId.HasValue ? "available" : "balance due";
                    throw new InvalidOperationException(
                        $"Receipt would over-pay Invoice #{inv.InvoiceNumber} ({label} is {collectible - alreadyPaid:0.00}).");
                }
            }
        }

        // ── Recompute helpers ─────────────────────────────────────────────────
        // AmountPaid = Σ allocation amounts from NON-cancelled payments. Run
        // after the allocation rows are persisted so the query sees them.

        private async Task RecomputeInvoiceAsync(int invoiceId)
        {
            // Settled = cash + settle-remainder adjustment — both clear the invoice.
            var paid = await _context.PaymentAllocations
                .Where(a => a.InvoiceId == invoiceId && !a.Payment.IsCancelled)
                .SumAsync(a => (decimal?)(a.Amount + a.AdjustmentAmount)) ?? 0m;
            var inv = await _context.Invoices.FirstOrDefaultAsync(i => i.Id == invoiceId);
            if (inv != null) inv.AmountPaid = paid;
        }

        private async Task RecomputePurchaseBillAsync(int billId)
        {
            var paid = await _context.PaymentAllocations
                .Where(a => a.PurchaseBillId == billId && !a.Payment.IsCancelled)
                .SumAsync(a => (decimal?)(a.Amount + a.AdjustmentAmount)) ?? 0m;
            var bill = await _context.PurchaseBills.FirstOrDefaultAsync(b => b.Id == billId);
            if (bill != null) bill.AmountPaid = paid;
        }

        // ── Mapping ───────────────────────────────────────────────────────────

        private static PaymentDto ToDto(Payment p, IReadOnlyDictionary<(string, int), string> names,
            IReadOnlyDictionary<int, (int? Id, string Name)> banks)
        {
            var prefix = p.Direction == PaymentDirection.Receipt ? "RCP" : "PMT";
            // A Client/Supplier name comes from the FK (never drifts); an "Other"
            // payee has no row to join, so its typed name is what we stored.
            string? contactName = p.ContactName;
            if (p.ContactId.HasValue
                && names.TryGetValue((NormalizeContactType(p.ContactType), p.ContactId.Value), out var n))
                contactName = n;

            // Show the bank/cash account NAME, not the stored code. The migration
            // stored the legacy GL code in BankAccountName; resolve it (or the FK)
            // to the chart-of-accounts name, and surface the resolved id so the
            // edit form can pre-select it.
            int? bankId = p.BankAccountId;
            string? bankName = p.BankAccountName;
            if (banks.TryGetValue(p.Id, out var b)) { bankId = b.Id ?? bankId; bankName = b.Name; }

            return new PaymentDto
            {
                Id = p.Id,
                CompanyId = p.CompanyId,
                Direction = p.Direction.ToString(),
                Number = p.Number,
                Reference = $"{prefix}-{p.Number:D4}",
                Date = p.Date,
                ContactType = p.ContactType,
                ContactId = p.ContactId,
                ContactName = contactName,
                DivisionId = p.DivisionId,
                DivisionName = p.Division?.Name,
                BankAccountId = bankId,
                BankAccountName = bankName,
                Method = p.Method,
                Description = p.Description,
                Amount = p.Amount,
                // CASH only — AdjustmentAmount is non-cash: it settles the
                // invoice, not the receipt, and already has its own GL leg.
                UnallocatedAmount = p.Amount - p.Allocations.Sum(a => a.Amount),
                ChequeNumber = p.ChequeNumber,
                ChequeDate = p.ChequeDate,
                ChequeStatus = p.ChequeStatus.ToString(),
                IsPostDated = p.ChequeDate.HasValue && p.ChequeDate.Value.Date > p.Date.Date,
                IsCancelled = p.IsCancelled,
                CreatedAt = p.CreatedAt,
                Allocations = p.Allocations.Select(a => new PaymentAllocationDto
                {
                    Id = a.Id,
                    Kind = a.Kind.ToString(),
                    InvoiceId = a.InvoiceId,
                    InvoiceNumber = a.Invoice?.InvoiceNumber,
                    PurchaseBillId = a.PurchaseBillId,
                    PurchaseBillNumber = a.PurchaseBill?.PurchaseBillNumber,
                    AccountId = a.AccountId,
                    AccountName = a.Account?.Name,
                    DocumentLabel = a.Invoice != null ? $"Invoice #{a.Invoice.InvoiceNumber}"
                                  : a.PurchaseBill != null ? $"Bill #{a.PurchaseBill.PurchaseBillNumber}"
                                  : a.Account != null ? a.Account.Name
                                  : a.Kind == AllocationKind.OnAccount ? "Advance / on account"
                                  : a.AccountId.HasValue ? "Direct"
                                  : null,
                    Amount = a.Amount,
                    TaxRate = a.TaxRate,
                    TaxAmount = a.TaxAmount,
                    NetAmount = a.Amount - a.TaxAmount,
                    AdjustmentAmount = a.AdjustmentAmount,
                    AdjustmentAccountId = a.AdjustmentAccountId,
                    AdjustmentAccountName = a.AdjustmentAccount != null ? a.AdjustmentAccount.Name : null,
                }).ToList(),
            };
        }

        /// <summary>Batch-resolve Client/Supplier display names for the contacts
        /// referenced by a set of payments (avoids an N+1 in list views).</summary>
        private async Task<Dictionary<(string, int), string>> ResolveContactNamesAsync(IEnumerable<Payment> payments)
        {
            var result = new Dictionary<(string, int), string>();
            // Normalised, so a legacy row stored as "client" still resolves; and
            // paired with its payment's CompanyId, so resolving it can only ever
            // name a contact that company owns.
            var refs = payments.Where(p => p.ContactId.HasValue)
                .Select(p => (Type: NormalizeContactType(p.ContactType), p.CompanyId, Id: p.ContactId!.Value))
                .ToList();
            var clientKeys = refs.Where(x => x.Type == "Client").Select(x => (x.CompanyId, x.Id)).ToHashSet();
            var supplierKeys = refs.Where(x => x.Type == "Supplier").Select(x => (x.CompanyId, x.Id)).ToHashSet();
            var clientIds = clientKeys.Select(k => k.Id).Distinct().ToList();
            var supplierIds = supplierKeys.Select(k => k.Id).Distinct().ToList();

            if (clientIds.Count > 0)
            {
                var rows = await _context.Clients.Where(c => clientIds.Contains(c.Id))
                    .Select(c => new { c.Id, c.CompanyId, c.Name }).AsNoTracking().ToListAsync();
                // A ContactId pointing at another tenant resolves to NO name
                // rather than leaking one. The write path can no longer create
                // such a row; this covers anything already stored.
                foreach (var r in rows.Where(r => clientKeys.Contains((r.CompanyId, r.Id))))
                    result[("Client", r.Id)] = r.Name;
            }
            if (supplierIds.Count > 0)
            {
                var rows = await _context.Suppliers.Where(s => supplierIds.Contains(s.Id))
                    .Select(s => new { s.Id, s.CompanyId, s.Name }).AsNoTracking().ToListAsync();
                foreach (var r in rows.Where(r => supplierKeys.Contains((r.CompanyId, r.Id))))
                    result[("Supplier", r.Id)] = r.Name;
            }
            return result;
        }

        /// <summary>Resolve each payment's bank/cash account to its chart-of-accounts
        /// name: by the BankAccountId FK when set, otherwise by matching the stored
        /// BankAccountName against an Account.Code (the migration stored the legacy
        /// GL code there). Returns paymentId → (resolved account id, name).</summary>
        private async Task<Dictionary<int, (int? Id, string Name)>> ResolveBankAccountsAsync(IEnumerable<Payment> payments)
        {
            var list = payments.ToList();
            var result = new Dictionary<int, (int?, string)>();
            var companyIds = list.Select(p => p.CompanyId).Distinct().ToList();
            var ids = list.Where(p => p.BankAccountId.HasValue).Select(p => p.BankAccountId!.Value).Distinct().ToList();
            var codes = list.Where(p => !p.BankAccountId.HasValue && !string.IsNullOrWhiteSpace(p.BankAccountName))
                .Select(p => p.BankAccountName!.Trim()).Distinct().ToList();
            if (ids.Count == 0 && codes.Count == 0) return result;

            var accounts = await _context.Accounts
                .Where(a => companyIds.Contains(a.CompanyId)
                         && (ids.Contains(a.Id) || (a.Code != null && codes.Contains(a.Code))))
                .Select(a => new { a.Id, a.CompanyId, a.Code, a.Name })
                .AsNoTracking().ToListAsync();

            var byId = accounts.ToDictionary(a => a.Id, a => a.Name);
            var byCode = accounts.Where(a => a.Code != null)
                .GroupBy(a => (a.CompanyId, a.Code!))
                .ToDictionary(g => g.Key, g => (g.First().Id, g.First().Name));

            foreach (var p in list)
            {
                if (p.BankAccountId.HasValue && byId.TryGetValue(p.BankAccountId.Value, out var nm))
                    result[p.Id] = (p.BankAccountId, nm);
                else if (!string.IsNullOrWhiteSpace(p.BankAccountName)
                         && byCode.TryGetValue((p.CompanyId, p.BankAccountName.Trim()), out var hit))
                    result[p.Id] = (hit.Id, hit.Name);
            }
            return result;
        }

        private static string? Trimmed(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

        private static PaymentDirection ParseDirection(string? s) =>
            string.Equals(s, "Payment", StringComparison.OrdinalIgnoreCase)
                ? PaymentDirection.Payment
                : string.Equals(s, "Receipt", StringComparison.OrdinalIgnoreCase)
                    ? PaymentDirection.Receipt
                    : throw new InvalidOperationException("Direction must be 'Receipt' or 'Payment'.");

        private static ChequeStatus ParseChequeStatus(string? s, string? chequeNumber)
        {
            if (!string.IsNullOrWhiteSpace(s) && Enum.TryParse<ChequeStatus>(s, true, out var parsed))
                return parsed;
            // No explicit status: a cheque number implies a pending cheque.
            return string.IsNullOrWhiteSpace(chequeNumber) ? ChequeStatus.None : ChequeStatus.Pending;
        }

        public async Task<PrintPaymentVoucherDto?> GetPrintDataAsync(int id)
        {
            var p = await _context.Payments.AsNoTracking()
                .Include(x => x.Company)
                .Include(x => x.Division)
                .Include(x => x.Allocations)
                .FirstOrDefaultAsync(x => x.Id == id);
            if (p == null) return null;

            // Contact is a soft ref (ContactType + ContactId), resolve its name.
            // An "Other" payee has no row to resolve, so the free-text name typed
            // on the document is what the voucher prints.
            string contactName = p.ContactName ?? "";
            string? contactAddress = null, contactPhone = null;
            // Normalised comparison + tenant-scoped lookup: the voucher prints a
            // name, address AND phone, so a ContactId belonging to another
            // company must resolve to nothing rather than print their details.
            var contactType = NormalizeContactType(p.ContactType);
            if (p.ContactId.HasValue && contactType == "Client")
            {
                var c = await _context.Clients.AsNoTracking()
                    .FirstOrDefaultAsync(x => x.Id == p.ContactId.Value && x.CompanyId == p.CompanyId);
                contactName = c?.Name ?? ""; contactAddress = c?.Address; contactPhone = c?.Phone;
            }
            else if (p.ContactId.HasValue && contactType == "Supplier")
            {
                var s = await _context.Suppliers.AsNoTracking()
                    .FirstOrDefaultAsync(x => x.Id == p.ContactId.Value && x.CompanyId == p.CompanyId);
                contactName = s?.Name ?? ""; contactAddress = s?.Address; contactPhone = s?.Phone;
            }

            // Allocation document labels (invoice / bill numbers).
            var invIds = p.Allocations.Where(a => a.InvoiceId != null).Select(a => a.InvoiceId!.Value).ToList();
            var billIds = p.Allocations.Where(a => a.PurchaseBillId != null).Select(a => a.PurchaseBillId!.Value).ToList();
            var invMap = invIds.Count == 0 ? new() : await _context.Invoices.AsNoTracking()
                .Where(i => invIds.Contains(i.Id)).ToDictionaryAsync(i => i.Id, i => i.InvoiceNumber);
            var billMap = billIds.Count == 0 ? new() : await _context.PurchaseBills.AsNoTracking()
                .Where(b => billIds.Contains(b.Id)).ToDictionaryAsync(b => b.Id, b => b.PurchaseBillNumber);
            var sNo = 0;
            var allocs = p.Allocations.Select(a => new PrintPaymentAllocationDto
            {
                SNo = ++sNo,
                DocumentLabel = a.InvoiceId != null ? $"Invoice #{invMap.GetValueOrDefault(a.InvoiceId.Value)}"
                              : a.PurchaseBillId != null ? $"Bill #{billMap.GetValueOrDefault(a.PurchaseBillId.Value)}"
                              : "Direct",
                Amount = a.Amount,
            }).ToList();

            return new PrintPaymentVoucherDto
            {
                CompanyBrandName = p.Company?.BrandName ?? p.Company?.Name ?? "",
                CompanyLogoPath = p.Company?.LogoPath,
                CompanyAddress = p.Company?.FullAddress,
                CompanyPhone = p.Company?.Phone,
                DivisionName = p.Division?.Name,
                DivisionBrandName = p.Division?.BrandName,
                DivisionLogoPath = p.Division?.LogoPath,
                DivisionAddress = p.Division?.FullAddress,
                DivisionPhone = p.Division?.Phone,
                DivisionNTN = p.Division?.NTN,
                DivisionSTRN = p.Division?.STRN,
                DivisionEmail = p.Division?.Email,
                Direction = p.Direction.ToString(),
                Reference = (p.Direction == PaymentDirection.Receipt ? "RCV-" : "PMT-") + p.Number,
                Date = p.Date,
                ContactType = p.ContactType,
                ContactName = contactName,
                ContactAddress = contactAddress,
                ContactPhone = contactPhone,
                Method = p.Method,
                BankAccountName = p.BankAccountName,
                ChequeNumber = p.ChequeNumber,
                ChequeDate = p.ChequeDate,
                Description = p.Description,
                Amount = p.Amount,
                AmountInWords = NumberToWordsConverter.Convert(p.Amount),
                Allocations = allocs,
            };
        }
    }
}
