using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;

namespace MyApp.Api.Repositories.Implementations
{
    public class SalesOrderRepository : ISalesOrderRepository
    {
        private readonly AppDbContext _context;

        public SalesOrderRepository(AppDbContext context)
        {
            _context = context;
        }

        private IQueryable<SalesOrder> WithIncludes() =>
            _context.SalesOrders
                .Include(o => o.Items).ThenInclude(i => i.ItemType)
                .Include(o => o.Client)
                .Include(o => o.Company)
                .Include(o => o.SalesQuote)
                .Include(o => o.Division);

        public async Task<List<SalesOrder>> GetByCompanyAsync(int companyId)
        {
            return await WithIncludes()
                .Where(o => o.CompanyId == companyId)
                .OrderByDescending(o => o.SalesOrderNumber)
                .ToListAsync();
        }

        public async Task<(List<SalesOrder> Items, int TotalCount)> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize,
            string? search = null, string? status = null,
            int? clientId = null, DateTime? dateFrom = null, DateTime? dateTo = null,
            int? divisionId = null)
        {
            var query = WithIncludes().Where(o => o.CompanyId == companyId);

            if (!string.IsNullOrWhiteSpace(status))
                query = query.Where(o => o.Status == status);
            if (clientId.HasValue)
                query = query.Where(o => o.ClientId == clientId.Value);
            if (divisionId.HasValue)
                query = query.Where(o => o.DivisionId == divisionId.Value);
            if (dateFrom.HasValue)
                query = query.Where(o => o.OrderDate >= dateFrom.Value);
            if (dateTo.HasValue)
                query = query.Where(o => o.OrderDate <= dateTo.Value);
            if (!string.IsNullOrWhiteSpace(search))
            {
                var term = search.ToLower();
                query = query.Where(o =>
                    o.SalesOrderNumber.ToString().Contains(term) ||
                    (o.Client != null && o.Client.Name.ToLower().Contains(term)) ||
                    (o.CustomerPoNumber != null && o.CustomerPoNumber.ToLower().Contains(term)) ||
                    o.Items.Any(i => i.Description.ToLower().Contains(term) ||
                                     (i.ItemType != null && i.ItemType.Name.ToLower().Contains(term))));
            }

            var totalCount = await query.CountAsync();
            var items = await query
                .OrderByDescending(o => o.SalesOrderNumber)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .ToListAsync();
            return (items, totalCount);
        }

        public async Task<SalesOrder?> GetByIdAsync(int id)
        {
            return await WithIncludes().FirstOrDefaultAsync(o => o.Id == id);
        }

        public async Task<SalesOrder> UpdateAsync(SalesOrder order)
        {
            _context.SalesOrders.Update(order);
            await _context.SaveChangesAsync();
            return order;
        }

        public async Task DeleteAsync(SalesOrder order)
        {
            _context.SalesOrders.Remove(order);
            await _context.SaveChangesAsync();
        }

        public async Task<int> GetCountByCompanyAsync(int companyId)
        {
            return await _context.SalesOrders.CountAsync(o => o.CompanyId == companyId);
        }

        public async Task<int> GetMaxNumberAsync(int companyId)
        {
            return await _context.SalesOrders
                .Where(o => o.CompanyId == companyId)
                .MaxAsync(o => (int?)o.SalesOrderNumber) ?? 0;
        }

        public async Task<bool> HasChallansAsync(int salesOrderId)
        {
            return await _context.DeliveryChallans.AnyAsync(dc => dc.SalesOrderId == salesOrderId);
        }

        public async Task<List<SalesOrder>> GetOpenByCompanyAsync(int companyId)
        {
            return await WithIncludes()
                .Where(o => o.CompanyId == companyId && o.Status == "Open")
                .OrderByDescending(o => o.SalesOrderNumber)
                .ToListAsync();
        }
    }
}
