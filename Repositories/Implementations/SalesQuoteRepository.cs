using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;

namespace MyApp.Api.Repositories.Implementations
{
    public class SalesQuoteRepository : ISalesQuoteRepository
    {
        private readonly AppDbContext _context;

        public SalesQuoteRepository(AppDbContext context)
        {
            _context = context;
        }

        private IQueryable<SalesQuote> WithIncludes() =>
            _context.SalesQuotes
                .Include(q => q.Items).ThenInclude(i => i.ItemType)
                .Include(q => q.Client)
                .Include(q => q.Company)
                .Include(q => q.Division)
                .Include(q => q.ConvertedToSalesOrder);

        public async Task<List<SalesQuote>> GetByCompanyAsync(int companyId, HashSet<int>? allowedDivisionIds = null)
        {
            var query = WithIncludes().Where(q => q.CompanyId == companyId);
            if (allowedDivisionIds != null)
                query = query.Where(q => q.DivisionId == null || allowedDivisionIds.Contains(q.DivisionId.Value));
            return await query
                .OrderByDescending(q => q.QuoteNumber)
                .AsNoTracking()
                .ToListAsync();
        }

        public async Task<(List<SalesQuote> Items, int TotalCount)> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize,
            string? search = null, string? status = null,
            int? clientId = null, DateTime? dateFrom = null, DateTime? dateTo = null,
            int? divisionId = null, HashSet<int>? allowedDivisionIds = null)
        {
            var query = WithIncludes().Where(q => q.CompanyId == companyId);
            // Division-RBAC scope first (null = unrestricted); the operator's
            // explicit divisionId FILTER below is a view preference layered on
            // top — the controller asserts it against the same allowed set.
            if (allowedDivisionIds != null)
                query = query.Where(q => q.DivisionId == null || allowedDivisionIds.Contains(q.DivisionId.Value));

            if (!string.IsNullOrWhiteSpace(status))
            {
                // Status is derived, not stored: Accepted = any Sales Order
                // references the quote; Expired = past ValidUntil and not
                // accepted; Active = otherwise. Mirrors SalesQuoteService.
                var today = DateTime.UtcNow.Date;
                if (status == "Accepted")
                    query = query.Where(q => q.ConvertedToSalesOrderId != null
                        || _context.SalesOrders.Any(so => so.SalesQuoteId == q.Id));
                else if (status == "Expired")
                    query = query.Where(q => q.ConvertedToSalesOrderId == null
                        && !_context.SalesOrders.Any(so => so.SalesQuoteId == q.Id)
                        && q.ValidUntil != null && q.ValidUntil < today);
                else if (status == "Active")
                    query = query.Where(q => q.ConvertedToSalesOrderId == null
                        && !_context.SalesOrders.Any(so => so.SalesQuoteId == q.Id)
                        && (q.ValidUntil == null || q.ValidUntil >= today));
                else
                    query = query.Where(q => q.Status == status);
            }
            if (clientId.HasValue)
                query = query.Where(q => q.ClientId == clientId.Value);
            if (divisionId.HasValue)
                query = query.Where(q => q.DivisionId == divisionId.Value);
            if (dateFrom.HasValue)
                query = query.Where(q => q.Date >= dateFrom.Value);
            if (dateTo.HasValue)
                query = query.Where(q => q.Date <= dateTo.Value);
            if (!string.IsNullOrWhiteSpace(search))
            {
                var term = search.ToLower();
                query = query.Where(q =>
                    q.QuoteNumber.ToString().Contains(term) ||
                    (q.Client != null && q.Client.Name.ToLower().Contains(term)) ||
                    (q.CustomerEnquiryRef != null && q.CustomerEnquiryRef.ToLower().Contains(term)) ||
                    q.Items.Any(i => i.Description.ToLower().Contains(term) ||
                                     (i.ItemType != null && i.ItemType.Name.ToLower().Contains(term))));
            }

            var totalCount = await query.CountAsync();
            var items = await query
                .OrderByDescending(q => q.QuoteNumber)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .AsNoTracking()
                .ToListAsync();
            return (items, totalCount);
        }

        public async Task<SalesQuote?> GetByIdAsync(int id)
        {
            return await WithIncludes().FirstOrDefaultAsync(q => q.Id == id);
        }

        public async Task<SalesQuote> UpdateAsync(SalesQuote quote)
        {
            _context.SalesQuotes.Update(quote);
            await _context.SaveChangesAsync();
            return quote;
        }

        public async Task DeleteAsync(SalesQuote quote)
        {
            _context.SalesQuotes.Remove(quote);
            await _context.SaveChangesAsync();
        }

        public async Task<int> GetCountByCompanyAsync(int companyId, HashSet<int>? allowedDivisionIds = null)
        {
            var query = _context.SalesQuotes.Where(q => q.CompanyId == companyId);
            if (allowedDivisionIds != null)
                query = query.Where(q => q.DivisionId == null || allowedDivisionIds.Contains(q.DivisionId.Value));
            return await query.CountAsync();
        }

        public async Task<int> GetMaxNumberAsync(int companyId)
        {
            return await _context.SalesQuotes
                .Where(q => q.CompanyId == companyId)
                .MaxAsync(q => (int?)q.QuoteNumber) ?? 0;
        }

        // Division-scoped max. A division has its own quote sequence; company-
        // level quotes are the DivisionId == null scope. Branch explicitly so
        // the null case translates to `WHERE DivisionId IS NULL` rather than a
        // parameter equality that never matches.
        public async Task<int> GetMaxNumberAsync(int companyId, int? divisionId)
        {
            var q = _context.SalesQuotes.Where(s => s.CompanyId == companyId);
            q = divisionId.HasValue
                ? q.Where(s => s.DivisionId == divisionId.Value)
                : q.Where(s => s.DivisionId == null);
            return await q.MaxAsync(s => (int?)s.QuoteNumber) ?? 0;
        }

        // Max quote number per scope (DivisionId → max), in one round-trip, so
        // the list views can flag IsLatest per division without an N+1.
        // Key 0 = the company-level (DivisionId == null) scope: Dictionary
        // can't hold a null key — the old Dictionary<int?, int> shape threw
        // ArgumentNullException the moment a company had a no-division quote
        // (division ids are identity ints, so 0 can't collide).
        public async Task<Dictionary<int, int>> GetMaxNumbersByScopeAsync(int companyId)
        {
            var rows = await _context.SalesQuotes
                .Where(q => q.CompanyId == companyId)
                .GroupBy(q => q.DivisionId)
                .Select(g => new { DivisionId = g.Key, Max = g.Max(x => x.QuoteNumber) })
                .ToListAsync();
            return rows.ToDictionary(r => r.DivisionId ?? 0, r => r.Max);
        }
    }
}
