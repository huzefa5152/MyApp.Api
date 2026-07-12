using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;

namespace MyApp.Api.Repositories.Implementations
{
    public class WithholdingTaxReceiptRepository : IWithholdingTaxReceiptRepository
    {
        private readonly AppDbContext _context;

        public WithholdingTaxReceiptRepository(AppDbContext context)
        {
            _context = context;
        }

        private IQueryable<WithholdingTaxReceipt> WithIncludes() =>
            _context.WithholdingTaxReceipts
                .Include(r => r.Client)
                .Include(r => r.Division);

        public async Task<List<WithholdingTaxReceipt>> GetByCompanyAsync(int companyId, HashSet<int>? allowedDivisionIds = null)
        {
            var query = WithIncludes().Where(r => r.CompanyId == companyId);
            if (allowedDivisionIds != null)
                query = query.Where(r => r.DivisionId == null || allowedDivisionIds.Contains(r.DivisionId.Value));
            return await query
                .OrderByDescending(r => r.Date)
                .ThenByDescending(r => r.ReceiptNumber)
                .ToListAsync();
        }

        public async Task<WithholdingTaxReceipt?> GetByIdAsync(int id) =>
            await WithIncludes().FirstOrDefaultAsync(r => r.Id == id);

        public async Task<WithholdingTaxReceipt> CreateAsync(WithholdingTaxReceipt receipt)
        {
            _context.WithholdingTaxReceipts.Add(receipt);
            await _context.SaveChangesAsync();
            return receipt;
        }

        public async Task<WithholdingTaxReceipt> UpdateAsync(WithholdingTaxReceipt receipt)
        {
            _context.WithholdingTaxReceipts.Update(receipt);
            await _context.SaveChangesAsync();
            return receipt;
        }

        public async Task DeleteAsync(WithholdingTaxReceipt receipt)
        {
            _context.WithholdingTaxReceipts.Remove(receipt);
            await _context.SaveChangesAsync();
        }

        public async Task<int> GetCountByCompanyAsync(int companyId, HashSet<int>? allowedDivisionIds = null)
        {
            var query = _context.WithholdingTaxReceipts.Where(r => r.CompanyId == companyId);
            if (allowedDivisionIds != null)
                query = query.Where(r => r.DivisionId == null || allowedDivisionIds.Contains(r.DivisionId.Value));
            return await query.CountAsync();
        }

        public async Task<int> GetMaxNumberAsync(int companyId, int? divisionId)
        {
            var query = _context.WithholdingTaxReceipts.Where(r => r.CompanyId == companyId);
            query = divisionId.HasValue
                ? query.Where(r => r.DivisionId == divisionId.Value)
                : query.Where(r => r.DivisionId == null);
            return await query.Select(r => (int?)r.ReceiptNumber).MaxAsync() ?? 0;
        }
    }
}
