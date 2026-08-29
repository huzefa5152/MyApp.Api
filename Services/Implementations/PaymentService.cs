using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
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

            // Validate each line: exactly one target, positive amount, correct
            // side for the direction. Collect the documents we'll need to touch.
            var invoiceIds = new List<int>();
            var billIds = new List<int>();
            var glEnabled = await _posting.IsEnabledAsync(companyId);
            var adjAccountIds = new HashSet<int>();
            foreach (var a in dto.Allocations)
            {
                var targets = new[] { a.InvoiceId.HasValue, a.PurchaseBillId.HasValue, a.AccountId.HasValue }
                    .Count(x => x);
                if (targets != 1)
                    throw new InvalidOperationException("Each allocation line must target exactly one of: invoice, purchase bill, or account.");
                if (a.Amount < 0 || a.AdjustmentAmount < 0)
                    throw new InvalidOperationException("Allocation amounts cannot be negative.");
                // A line may carry cash, a settle-remainder adjustment, or both —
                // but the total applied must be positive.
                if (a.Amount + a.AdjustmentAmount <= 0)
                    throw new InvalidOperationException("Each allocation must apply a positive amount (cash and/or adjustment).");

                if (direction == PaymentDirection.Receipt && a.PurchaseBillId.HasValue)
                    throw new InvalidOperationException("A receipt cannot settle a purchase bill.");
                if (direction == PaymentDirection.Payment && a.InvoiceId.HasValue)
                    throw new InvalidOperationException("A payment cannot settle a sales invoice.");

                if (a.AdjustmentAmount > 0)
                {
                    // The adjustment clears part of a settled invoice/bill — it has
                    // no meaning on a direct account line.
                    if (!a.InvoiceId.HasValue && !a.PurchaseBillId.HasValue)
                        throw new InvalidOperationException("A settle-remainder adjustment can only be applied to an invoice or bill line.");
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

            AssertAllocationsFitAmount(dto);

            // Period-close guard (GL lock date) before any writes.
            await _posting.AssertPeriodOpenAsync(companyId, dto.Date == default ? PakistanClock.Today : dto.Date);

            // Cross-tenant guard: every referenced document must belong to this
            // company (never trust the ids in the body — CLAUDE.md §1/§4).
            var invoices = await _context.Invoices
                .Where(i => invoiceIds.Contains(i.Id)).ToListAsync();
            var bills = await _context.PurchaseBills
                .Where(b => billIds.Contains(b.Id)).ToListAsync();
            if (invoices.Any(i => i.CompanyId != companyId) || invoices.Count != invoiceIds.Distinct().Count())
                throw new InvalidOperationException("One or more invoices do not belong to this company.");
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

            // Contact must belong to the company too, when one is named.
            if (dto.ContactId.HasValue)
            {
                if (dto.ContactType == "Client" &&
                    !await _context.Clients.AnyAsync(c => c.Id == dto.ContactId.Value && c.CompanyId == companyId))
                    throw new InvalidOperationException("Client does not belong to this company.");
                if (dto.ContactType == "Supplier" &&
                    !await _context.Suppliers.AnyAsync(s => s.Id == dto.ContactId.Value && s.CompanyId == companyId))
                    throw new InvalidOperationException("Supplier does not belong to this company.");
            }

            // Over-allocation guard: a single document can't be paid beyond its
            // grand total. Sum this payment's lines per document, add to what's
            // already paid, and reject anything over the total.
            foreach (var grp in dto.Allocations.Where(a => a.InvoiceId.HasValue)
                         .GroupBy(a => a.InvoiceId!.Value))
            {
                var inv = invoices.First(i => i.Id == grp.Key);
                // Cap at the COLLECTIBLE (GrandTotal − withheld), not GrandTotal:
                // the withheld slice is settled by the customer at invoice time,
                // so only the reduced balance can be received.
                var collectible = WithholdingTaxCalculator.Collectible(inv.GrandTotal, inv.WithholdingTaxAmount);
                var newTotal = inv.AmountPaid + grp.Sum(a => a.Amount + a.AdjustmentAmount);
                if (newTotal > collectible)
                    throw new InvalidOperationException(
                        $"Receipt would over-pay Invoice #{inv.InvoiceNumber} (balance due is {collectible - inv.AmountPaid:0.00}).");
            }
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
                ContactType = dto.ContactType,   // canonical + trimmed already
                ContactId = dto.ContactId,
                DivisionId = divisionId,
                BankAccountId = dto.BankAccountId,
                BankAccountName = bankAccountName,
                Method = string.IsNullOrWhiteSpace(dto.Method) ? "Cash" : dto.Method.Trim(),
                Description = Trimmed(dto.Description),
                Amount = ResolveAmount(dto),
                ChequeNumber = Trimmed(dto.ChequeNumber),
                ChequeDate = dto.ChequeDate,
                ChequeStatus = ParseChequeStatus(dto.ChequeStatus, dto.ChequeNumber),
                Allocations = dto.Allocations.Select(a => new PaymentAllocation
                {
                    InvoiceId = a.InvoiceId,
                    PurchaseBillId = a.PurchaseBillId,
                    AccountId = a.AccountId,
                    Amount = a.Amount,
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

            var invoiceIds = new List<int>();
            var billIds = new List<int>();
            foreach (var a in dto.Allocations)
            {
                var targets = new[] { a.InvoiceId.HasValue, a.PurchaseBillId.HasValue, a.AccountId.HasValue }.Count(x => x);
                if (targets != 1)
                    throw new InvalidOperationException("Each allocation line must target exactly one of: invoice, purchase bill, or account.");
                if (a.Amount <= 0)
                    throw new InvalidOperationException("Allocation amounts must be greater than zero.");
                if (direction == PaymentDirection.Receipt && a.PurchaseBillId.HasValue)
                    throw new InvalidOperationException("A receipt cannot settle a purchase bill.");
                if (direction == PaymentDirection.Payment && a.InvoiceId.HasValue)
                    throw new InvalidOperationException("A payment cannot settle a sales invoice.");
                if (a.InvoiceId.HasValue) invoiceIds.Add(a.InvoiceId.Value);
                if (a.PurchaseBillId.HasValue) billIds.Add(a.PurchaseBillId.Value);
            }
            AssertAllocationsFitAmount(dto);
            await AssertAllocationAccountsAsync(companyId, dto);

            var invoices = await _context.Invoices.Where(i => invoiceIds.Contains(i.Id)).ToListAsync();
            var bills = await _context.PurchaseBills.Where(b => billIds.Contains(b.Id)).ToListAsync();
            if (invoices.Any(i => i.CompanyId != companyId) || invoices.Count != invoiceIds.Distinct().Count())
                throw new InvalidOperationException("One or more invoices do not belong to this company.");
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

            if (dto.ContactId.HasValue)
            {
                if (dto.ContactType == "Client" &&
                    !await _context.Clients.AnyAsync(c => c.Id == dto.ContactId.Value && c.CompanyId == companyId))
                    throw new InvalidOperationException("Client does not belong to this company.");
                if (dto.ContactType == "Supplier" &&
                    !await _context.Suppliers.AnyAsync(s => s.Id == dto.ContactId.Value && s.CompanyId == companyId))
                    throw new InvalidOperationException("Supplier does not belong to this company.");
            }

            // Over-allocation guard, EXCLUDING this payment's own current lines
            // (we're replacing them), so editing down/up stays within the total.
            foreach (var grp in dto.Allocations.Where(a => a.InvoiceId.HasValue).GroupBy(a => a.InvoiceId!.Value))
            {
                var inv = invoices.First(i => i.Id == grp.Key);
                var collectible = WithholdingTaxCalculator.Collectible(inv.GrandTotal, inv.WithholdingTaxAmount);
                var paidByOthers = await _context.PaymentAllocations
                    .Where(pa => pa.InvoiceId == grp.Key && pa.PaymentId != id && !pa.Payment.IsCancelled)
                    .SumAsync(pa => (decimal?)(pa.Amount + pa.AdjustmentAmount)) ?? 0m;
                if (paidByOthers + grp.Sum(a => a.Amount + a.AdjustmentAmount) > collectible)
                    throw new InvalidOperationException(
                        $"Receipt would over-pay Invoice #{inv.InvoiceNumber} (available is {collectible - paidByOthers:0.00}).");
            }
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
                payment.ContactType = dto.ContactType;   // canonical + trimmed already
                payment.ContactId = dto.ContactId;
                payment.DivisionId = dto.DivisionId;
                payment.BankAccountId = dto.BankAccountId;
                payment.BankAccountName = bankAccountName;
                payment.Method = string.IsNullOrWhiteSpace(dto.Method) ? "Cash" : dto.Method.Trim();
                payment.Description = Trimmed(dto.Description);
                payment.ChequeNumber = Trimmed(dto.ChequeNumber);
                payment.ChequeDate = dto.ChequeDate;
                payment.ChequeStatus = ParseChequeStatus(dto.ChequeStatus, dto.ChequeNumber);
                payment.Amount = ResolveAmount(dto);

                // Replace allocation lines.
                _context.PaymentAllocations.RemoveRange(payment.Allocations);
                await _context.SaveChangesAsync();
                _context.PaymentAllocations.AddRange(dto.Allocations.Select(a => new PaymentAllocation
                {
                    PaymentId = payment.Id,
                    InvoiceId = a.InvoiceId,
                    PurchaseBillId = a.PurchaseBillId,
                    AccountId = a.AccountId,
                    Amount = a.Amount,
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
            return t;
        }

        /// <summary>A receipt taken from a named customer — the only document
        /// whose unapplied balance has somewhere to live (Advance from
        /// Customers). Money-out and party-less "Other" receipts have no such
        /// account, so they still need at least one allocation line.</summary>
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

        /// <summary>Cash total of the document. Explicit when supplied; otherwise
        /// Σ allocation cash, which is what every pre-2026-08-29 caller meant.</summary>
        private static decimal ResolveAmount(CreatePaymentDto dto) =>
            dto.Amount ?? dto.Allocations.Sum(a => a.Amount);

        /// <summary>Allocations may spend part of the receipt's CASH, but never
        /// more than it — the difference is the advance, and it cannot be
        /// negative. AdjustmentAmount is deliberately absent: it is a non-cash
        /// write-off, so a 1000 receipt may legitimately clear an 1100 invoice
        /// as 1000 cash + 100 written off.</summary>
        private static void AssertAllocationsFitAmount(CreatePaymentDto dto)
        {
            var amount = ResolveAmount(dto);
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
        /// request body and now carry a real FK.</summary>
        private async Task AssertAllocationAccountsAsync(int companyId, CreatePaymentDto dto)
        {
            var accountIds = dto.Allocations!
                .Where(a => a.AccountId.HasValue)
                .Select(a => a.AccountId!.Value).Distinct().ToList();
            if (accountIds.Count == 0) return;
            var ok = await _context.Accounts.AsNoTracking()
                .CountAsync(a => accountIds.Contains(a.Id) && a.CompanyId == companyId && a.IsActive);
            if (ok != accountIds.Count)
                throw new InvalidOperationException("One or more allocation accounts do not belong to this company.");
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
            string? contactName = null;
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
                    InvoiceId = a.InvoiceId,
                    InvoiceNumber = a.Invoice?.InvoiceNumber,
                    PurchaseBillId = a.PurchaseBillId,
                    PurchaseBillNumber = a.PurchaseBill?.PurchaseBillNumber,
                    AccountId = a.AccountId,
                    DocumentLabel = a.Invoice != null ? $"Invoice #{a.Invoice.InvoiceNumber}"
                                  : a.PurchaseBill != null ? $"Bill #{a.PurchaseBill.PurchaseBillNumber}"
                                  : a.AccountId.HasValue ? "Direct"
                                  : null,
                    Amount = a.Amount,
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
            string contactName = "";
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
