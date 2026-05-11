using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;

namespace MyApp.Api.Repositories.Implementations
{
    public class InvoiceRepository : IInvoiceRepository
    {
        private readonly AppDbContext _context;

        public InvoiceRepository(AppDbContext context)
        {
            _context = context;
        }

        public async Task<List<Invoice>> GetByCompanyAsync(int companyId)
        {
            // Default list excludes IsDemo bills — those are managed via the
            // FBR Sandbox tab, not the regular Bills page.
            return await _context.Invoices
                .Include(i => i.Client)
                .Include(i => i.Items)
                .Include(i => i.DeliveryChallans)
                .Where(i => i.CompanyId == companyId && !i.IsDemo)
                .OrderByDescending(i => i.InvoiceNumber)
                .ToListAsync();
        }

        public async Task<(List<Invoice> Items, int TotalCount)> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize,
            string? search = null, int? clientId = null,
            DateTime? dateFrom = null, DateTime? dateTo = null)
        {
            var query = _context.Invoices
                .Include(i => i.Client)
                .Include(i => i.Items)
                .Include(i => i.DeliveryChallans)
                .Where(i => i.CompanyId == companyId && !i.IsDemo);

            if (clientId.HasValue)
                query = query.Where(i => i.ClientId == clientId.Value);

            if (dateFrom.HasValue)
                query = query.Where(i => i.Date >= dateFrom.Value);

            if (dateTo.HasValue)
                query = query.Where(i => i.Date <= dateTo.Value);

            if (!string.IsNullOrWhiteSpace(search))
            {
                var term = search.ToLower();
                query = query.Where(i =>
                    i.InvoiceNumber.ToString().Contains(term) ||
                    (i.FbrInvoiceNumber != null && i.FbrInvoiceNumber.ToLower().Contains(term)) ||
                    (i.Client != null && i.Client.Name.ToLower().Contains(term)) ||
                    i.Items.Any(item => item.Description.ToLower().Contains(term) ||
                                         (item.ItemType != null && item.ItemType.Name.ToLower().Contains(term))) ||
                    i.DeliveryChallans.Any(dc => dc.ChallanNumber.ToString().Contains(term) ||
                                                  (dc.PoNumber != null && dc.PoNumber.ToLower().Contains(term))));
            }

            var totalCount = await query.CountAsync();
            var items = await query
                .OrderByDescending(i => i.InvoiceNumber)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .ToListAsync();

            return (items, totalCount);
        }

        public async Task<Invoice?> GetByIdAsync(int id)
        {
            return await _context.Invoices
                .Include(i => i.Company)
                .Include(i => i.Client)
                .Include(i => i.Items)
                    .ThenInclude(ii => ii.DeliveryItem)
                .Include(i => i.Items)
                    .ThenInclude(ii => ii.ItemType)
                // Dual-book overlay (2026-05-11). Pulled on detail
                // fetches so EditBillForm in Invoice mode can hydrate
                // the AdjustedXxx values as "current" while keeping
                // the InvoiceItem row above as "original".
                .Include(i => i.Items)
                    .ThenInclude(ii => ii.Adjustment)
                .Include(i => i.DeliveryChallans)
                    .ThenInclude(dc => dc.Items)
                .FirstOrDefaultAsync(i => i.Id == id);
        }

        public async Task<Invoice> CreateAsync(Invoice invoice)
        {
            _context.Invoices.Add(invoice);
            await _context.SaveChangesAsync();
            return invoice;
        }

        public async Task UpdateAsync(Invoice invoice)
        {
            _context.Invoices.Update(invoice);
            await _context.SaveChangesAsync();
        }

        public async Task<int> GetTotalCountAsync()
        {
            return await _context.Invoices.CountAsync(i => !i.IsDemo);
        }

        public async Task<int> GetCountByCompanyAsync(int companyId)
        {
            return await _context.Invoices.CountAsync(i => i.CompanyId == companyId && !i.IsDemo);
        }

        public async Task<bool> HasInvoicesForClientAsync(int clientId)
        {
            return await _context.Invoices.AnyAsync(i => i.ClientId == clientId);
        }

        public async Task<bool> HasInvoicesForCompanyAsync(int companyId)
        {
            return await _context.Invoices.AnyAsync(i => i.CompanyId == companyId);
        }

        public async Task<Dictionary<int, bool>> HasInvoicesForClientsAsync(IEnumerable<int> clientIds)
        {
            var clientsWithInvoices = await _context.Invoices
                .Where(i => clientIds.Contains(i.ClientId))
                .Select(i => i.ClientId)
                .Distinct()
                .ToListAsync();

            return clientIds.ToDictionary(id => id, id => clientsWithInvoices.Contains(id));
        }
    }
}
