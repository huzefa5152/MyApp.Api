using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models.Accounting;
using MyApp.Api.Repositories.Interfaces;

namespace MyApp.Api.Repositories.Implementations
{
    public class PaymentRepository : IPaymentRepository
    {
        private readonly AppDbContext _context;

        public PaymentRepository(AppDbContext context)
        {
            _context = context;
        }

        private IQueryable<Payment> WithIncludes() =>
            _context.Payments
                .Include(p => p.Division)
                .Include(p => p.Allocations).ThenInclude(a => a.Invoice)
                .Include(p => p.Allocations).ThenInclude(a => a.PurchaseBill);

        public async Task<(List<Payment> Items, int TotalCount)> GetPagedByCompanyAsync(
            int companyId, PaymentDirection direction, int page, int pageSize,
            string? search = null, int? contactId = null,
            DateTime? dateFrom = null, DateTime? dateTo = null)
        {
            var query = WithIncludes()
                .Where(p => p.CompanyId == companyId && p.Direction == direction);

            if (contactId.HasValue)
                query = query.Where(p => p.ContactId == contactId.Value);
            if (dateFrom.HasValue)
                query = query.Where(p => p.Date >= dateFrom.Value);
            if (dateTo.HasValue)
                query = query.Where(p => p.Date <= dateTo.Value);
            if (!string.IsNullOrWhiteSpace(search))
            {
                var term = search.ToLower();
                query = query.Where(p =>
                    p.Number.ToString().Contains(term) ||
                    (p.Description != null && p.Description.ToLower().Contains(term)) ||
                    (p.ChequeNumber != null && p.ChequeNumber.ToLower().Contains(term)) ||
                    (p.BankAccountName != null && p.BankAccountName.ToLower().Contains(term)));
            }

            var totalCount = await query.CountAsync();
            var items = await query
                .OrderByDescending(p => p.Date).ThenByDescending(p => p.Number)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .AsNoTracking()
                .ToListAsync();
            return (items, totalCount);
        }

        public async Task<Payment?> GetByIdAsync(int id) =>
            await WithIncludes().FirstOrDefaultAsync(p => p.Id == id);

        public async Task<List<Payment>> GetByInvoiceAsync(int companyId, int invoiceId) =>
            await WithIncludes()
                .Where(p => p.CompanyId == companyId && !p.IsCancelled
                    && p.Allocations.Any(a => a.InvoiceId == invoiceId))
                .OrderByDescending(p => p.Date).ThenByDescending(p => p.Number)
                .AsNoTracking()
                .ToListAsync();

        public async Task<List<Payment>> GetByPurchaseBillAsync(int companyId, int purchaseBillId) =>
            await WithIncludes()
                .Where(p => p.CompanyId == companyId && !p.IsCancelled
                    && p.Allocations.Any(a => a.PurchaseBillId == purchaseBillId))
                .OrderByDescending(p => p.Date).ThenByDescending(p => p.Number)
                .AsNoTracking()
                .ToListAsync();

        public async Task<int> GetMaxNumberAsync(int companyId, PaymentDirection direction) =>
            await _context.Payments
                .Where(p => p.CompanyId == companyId && p.Direction == direction)
                .MaxAsync(p => (int?)p.Number) ?? 0;

        public async Task DeleteAsync(Payment payment)
        {
            _context.Payments.Remove(payment);
            await _context.SaveChangesAsync();
        }
    }
}
