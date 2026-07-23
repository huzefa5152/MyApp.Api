using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models.Accounting;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// AR/AP payment subledger — receipts (money in) and payments (money out).
    /// GL-free port: master has no Chart of Accounts / posting engine, so this
    /// keeps only the subledger (AmountPaid reflow on the settled documents,
    /// over-allocation guard, per-direction numbering, cheque lifecycle) and
    /// drops every posting / period-close / account-validation call.
    /// </summary>
    public class PaymentService : IPaymentService
    {
        private readonly IPaymentRepository _repo;
        private readonly AppDbContext _context;
        private readonly ILogger<PaymentService> _logger;

        public PaymentService(IPaymentRepository repo, AppDbContext context,
            ILogger<PaymentService> logger)
        {
            _repo = repo;
            _context = context;
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
            return new PagedResult<PaymentDto>
            {
                Items = items.Select(p => ToDto(p, names)).ToList(),
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
            return ToDto(p, names);
        }

        public async Task<List<PaymentDto>> GetByInvoiceAsync(int companyId, int invoiceId)
        {
            var list = await _repo.GetByInvoiceAsync(companyId, invoiceId);
            var names = await ResolveContactNamesAsync(list);
            return list.Select(p => ToDto(p, names)).ToList();
        }

        public async Task<List<PaymentDto>> GetByPurchaseBillAsync(int companyId, int purchaseBillId)
        {
            var list = await _repo.GetByPurchaseBillAsync(companyId, purchaseBillId);
            var names = await ResolveContactNamesAsync(list);
            return list.Select(p => ToDto(p, names)).ToList();
        }

        // ── Create ───────────────────────────────────────────────────────────

        public async Task<PaymentDto> CreateAsync(int companyId, CreatePaymentDto dto)
        {
            var direction = ParseDirection(dto.Direction);

            if (dto.Allocations == null || dto.Allocations.Count == 0)
                throw new InvalidOperationException("A payment needs at least one allocation line.");

            // Validate each line: exactly one target, positive amount, correct
            // side for the direction. Collect the documents we'll need to touch.
            var invoiceIds = new List<int>();
            var billIds = new List<int>();
            foreach (var a in dto.Allocations)
            {
                var targets = new[] { a.InvoiceId.HasValue, a.PurchaseBillId.HasValue, a.AccountId.HasValue }
                    .Count(x => x);
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

            // Bank/cash destination is a free-text name in master (no Chart of
            // Accounts). Trim it; BankAccountId is a passthrough column only.
            string? bankAccountName = Trimmed(dto.BankAccountName);

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
                var newTotal = inv.AmountPaid + grp.Sum(a => a.Amount);
                if (newTotal > inv.GrandTotal)
                    throw new InvalidOperationException(
                        $"Receipt would over-pay Invoice #{inv.InvoiceNumber} (balance due is {inv.GrandTotal - inv.AmountPaid:0.00}).");
            }
            foreach (var grp in dto.Allocations.Where(a => a.PurchaseBillId.HasValue)
                         .GroupBy(a => a.PurchaseBillId!.Value))
            {
                var bill = bills.First(b => b.Id == grp.Key);
                var newTotal = bill.AmountPaid + grp.Sum(a => a.Amount);
                if (newTotal > bill.GrandTotal)
                    throw new InvalidOperationException(
                        $"Payment would over-pay Bill #{bill.PurchaseBillNumber} (balance due is {bill.GrandTotal - bill.AmountPaid:0.00}).");
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
                ContactType = string.IsNullOrWhiteSpace(dto.ContactType) ? "Other" : dto.ContactType.Trim(),
                ContactId = dto.ContactId,
                BankAccountId = dto.BankAccountId,
                BankAccountName = bankAccountName,
                Method = string.IsNullOrWhiteSpace(dto.Method) ? "Cash" : dto.Method.Trim(),
                Description = Trimmed(dto.Description),
                Amount = dto.Allocations.Sum(a => a.Amount),
                ChequeNumber = Trimmed(dto.ChequeNumber),
                ChequeDate = dto.ChequeDate,
                ChequeStatus = ParseChequeStatus(dto.ChequeStatus, dto.ChequeNumber),
                Allocations = dto.Allocations.Select(a => new PaymentAllocation
                {
                    InvoiceId = a.InvoiceId,
                    PurchaseBillId = a.PurchaseBillId,
                    AccountId = a.AccountId,
                    Amount = a.Amount,
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

            if (dto.Allocations == null || dto.Allocations.Count == 0)
                throw new InvalidOperationException("A payment needs at least one allocation line.");

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

            var invoices = await _context.Invoices.Where(i => invoiceIds.Contains(i.Id)).ToListAsync();
            var bills = await _context.PurchaseBills.Where(b => billIds.Contains(b.Id)).ToListAsync();
            if (invoices.Any(i => i.CompanyId != companyId) || invoices.Count != invoiceIds.Distinct().Count())
                throw new InvalidOperationException("One or more invoices do not belong to this company.");
            if (bills.Any(b => b.CompanyId != companyId) || bills.Count != billIds.Distinct().Count())
                throw new InvalidOperationException("One or more purchase bills do not belong to this company.");

            string? bankAccountName = Trimmed(dto.BankAccountName);

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
                var paidByOthers = await _context.PaymentAllocations
                    .Where(pa => pa.InvoiceId == grp.Key && pa.PaymentId != id && !pa.Payment.IsCancelled)
                    .SumAsync(pa => (decimal?)pa.Amount) ?? 0m;
                if (paidByOthers + grp.Sum(a => a.Amount) > inv.GrandTotal)
                    throw new InvalidOperationException(
                        $"Receipt would over-pay Invoice #{inv.InvoiceNumber} (available is {inv.GrandTotal - paidByOthers:0.00}).");
            }
            foreach (var grp in dto.Allocations.Where(a => a.PurchaseBillId.HasValue).GroupBy(a => a.PurchaseBillId!.Value))
            {
                var bill = bills.First(b => b.Id == grp.Key);
                var paidByOthers = await _context.PaymentAllocations
                    .Where(pa => pa.PurchaseBillId == grp.Key && pa.PaymentId != id && !pa.Payment.IsCancelled)
                    .SumAsync(pa => (decimal?)pa.Amount) ?? 0m;
                if (paidByOthers + grp.Sum(a => a.Amount) > bill.GrandTotal)
                    throw new InvalidOperationException(
                        $"Payment would over-pay Bill #{bill.PurchaseBillNumber} (available is {bill.GrandTotal - paidByOthers:0.00}).");
            }

            // Documents this payment used to touch — reflow them too even if the
            // edit dropped them.
            var oldInvoiceIds = payment.Allocations.Where(a => a.InvoiceId.HasValue).Select(a => a.InvoiceId!.Value).Distinct().ToList();
            var oldBillIds = payment.Allocations.Where(a => a.PurchaseBillId.HasValue).Select(a => a.PurchaseBillId!.Value).Distinct().ToList();

            await using var tx = await _context.Database.BeginTransactionAsync();
            try
            {
                payment.Date = dto.Date == default ? payment.Date : dto.Date;
                payment.ContactType = string.IsNullOrWhiteSpace(dto.ContactType) ? "Other" : dto.ContactType.Trim();
                payment.ContactId = dto.ContactId;
                payment.BankAccountId = dto.BankAccountId;
                payment.BankAccountName = bankAccountName;
                payment.Method = string.IsNullOrWhiteSpace(dto.Method) ? "Cash" : dto.Method.Trim();
                payment.Description = Trimmed(dto.Description);
                payment.ChequeNumber = Trimmed(dto.ChequeNumber);
                payment.ChequeDate = dto.ChequeDate;
                payment.ChequeStatus = ParseChequeStatus(dto.ChequeStatus, dto.ChequeNumber);
                payment.Amount = dto.Allocations.Sum(a => a.Amount);

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
                }));
                await _context.SaveChangesAsync();

                foreach (var iid in oldInvoiceIds.Union(invoiceIds).Distinct()) await RecomputeInvoiceAsync(iid);
                foreach (var bid in oldBillIds.Union(billIds).Distinct()) await RecomputePurchaseBillAsync(bid);
                await _context.SaveChangesAsync();

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

            // Capture the documents this payment touched BEFORE the cascade
            // removes the allocation rows, so we can reflow their paid totals.
            var invoiceIds = payment.Allocations.Where(a => a.InvoiceId.HasValue)
                .Select(a => a.InvoiceId!.Value).Distinct().ToList();
            var billIds = payment.Allocations.Where(a => a.PurchaseBillId.HasValue)
                .Select(a => a.PurchaseBillId!.Value).Distinct().ToList();

            await using var tx = await _context.Database.BeginTransactionAsync();
            try
            {
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

        // ── Recompute helpers ─────────────────────────────────────────────────
        // AmountPaid = Σ allocation amounts from NON-cancelled payments. Run
        // after the allocation rows are persisted so the query sees them.

        private async Task RecomputeInvoiceAsync(int invoiceId)
        {
            var paid = await _context.PaymentAllocations
                .Where(a => a.InvoiceId == invoiceId && !a.Payment.IsCancelled)
                .SumAsync(a => (decimal?)a.Amount) ?? 0m;
            var inv = await _context.Invoices.FirstOrDefaultAsync(i => i.Id == invoiceId);
            if (inv != null) inv.AmountPaid = paid;
        }

        private async Task RecomputePurchaseBillAsync(int billId)
        {
            var paid = await _context.PaymentAllocations
                .Where(a => a.PurchaseBillId == billId && !a.Payment.IsCancelled)
                .SumAsync(a => (decimal?)a.Amount) ?? 0m;
            var bill = await _context.PurchaseBills.FirstOrDefaultAsync(b => b.Id == billId);
            if (bill != null) bill.AmountPaid = paid;
        }

        // ── Mapping ───────────────────────────────────────────────────────────

        private static PaymentDto ToDto(Payment p, IReadOnlyDictionary<(string, int), string> names)
        {
            var prefix = p.Direction == PaymentDirection.Receipt ? "RCP" : "PMT";
            string? contactName = null;
            if (p.ContactId.HasValue && names.TryGetValue((p.ContactType, p.ContactId.Value), out var n))
                contactName = n;

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
                BankAccountId = p.BankAccountId,
                BankAccountName = p.BankAccountName,
                Method = p.Method,
                Description = p.Description,
                Amount = p.Amount,
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
                }).ToList(),
            };
        }

        /// <summary>Batch-resolve Client/Supplier display names for the contacts
        /// referenced by a set of payments (avoids an N+1 in list views).</summary>
        private async Task<Dictionary<(string, int), string>> ResolveContactNamesAsync(IEnumerable<Payment> payments)
        {
            var result = new Dictionary<(string, int), string>();
            var clientIds = payments.Where(p => p.ContactType == "Client" && p.ContactId.HasValue)
                .Select(p => p.ContactId!.Value).Distinct().ToList();
            var supplierIds = payments.Where(p => p.ContactType == "Supplier" && p.ContactId.HasValue)
                .Select(p => p.ContactId!.Value).Distinct().ToList();

            if (clientIds.Count > 0)
            {
                var rows = await _context.Clients.Where(c => clientIds.Contains(c.Id))
                    .Select(c => new { c.Id, c.Name }).AsNoTracking().ToListAsync();
                foreach (var r in rows) result[("Client", r.Id)] = r.Name;
            }
            if (supplierIds.Count > 0)
            {
                var rows = await _context.Suppliers.Where(s => supplierIds.Contains(s.Id))
                    .Select(s => new { s.Id, s.Name }).AsNoTracking().ToListAsync();
                foreach (var r in rows) result[("Supplier", r.Id)] = r.Name;
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
                .Include(x => x.Allocations)
                .FirstOrDefaultAsync(x => x.Id == id);
            if (p == null) return null;

            // Contact is a soft ref (ContactType + ContactId), resolve its name.
            string contactName = "";
            string? contactAddress = null, contactPhone = null;
            if (p.ContactId.HasValue && p.ContactType == "Client")
            {
                var c = await _context.Clients.AsNoTracking().FirstOrDefaultAsync(x => x.Id == p.ContactId.Value);
                contactName = c?.Name ?? ""; contactAddress = c?.Address; contactPhone = c?.Phone;
            }
            else if (p.ContactId.HasValue && p.ContactType == "Supplier")
            {
                var s = await _context.Suppliers.AsNoTracking().FirstOrDefaultAsync(x => x.Id == p.ContactId.Value);
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
                CompanyNTN = p.Company?.NTN,
                CompanySTRN = p.Company?.STRN,
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
