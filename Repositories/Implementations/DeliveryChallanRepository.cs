using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;

namespace MyApp.Api.Repositories.Implementations
{
    public class DeliveryChallanRepository : IDeliveryChallanRepository
    {
        private readonly AppDbContext _context;

        public DeliveryChallanRepository(AppDbContext context)
        {
            _context = context;
        }

        public async Task<List<DeliveryChallan>> GetDeliveryChallansByCompanyAsync(int companyId)
        {
            return await _context.DeliveryChallans
                                 .Include(dc => dc.Items)
                                     .ThenInclude(i => i.ItemType)
                                 .Include(dc => dc.Client)
                                 .Where(dc => dc.CompanyId == companyId)
                                 .OrderBy(dc => dc.ChallanNumber)
                                 .ToListAsync();
        }

        public async Task<(List<DeliveryChallan> Items, int TotalCount)> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize,
            string? search = null, string? status = null,
            int? clientId = null, DateTime? dateFrom = null, DateTime? dateTo = null)
        {
            var query = _context.DeliveryChallans
                .Include(dc => dc.Items).ThenInclude(i => i.ItemType)
                .Include(dc => dc.Client)
                .Where(dc => dc.CompanyId == companyId);

            if (!string.IsNullOrWhiteSpace(status))
                query = query.Where(dc => dc.Status == status);

            if (clientId.HasValue)
                query = query.Where(dc => dc.ClientId == clientId.Value);

            if (dateFrom.HasValue)
                query = query.Where(dc => dc.DeliveryDate >= dateFrom.Value);

            if (dateTo.HasValue)
                query = query.Where(dc => dc.DeliveryDate <= dateTo.Value);

            if (!string.IsNullOrWhiteSpace(search))
            {
                var term = search.ToLower();
                query = query.Where(dc =>
                    dc.ChallanNumber.ToString().Contains(term) ||
                    (dc.Client != null && dc.Client.Name.ToLower().Contains(term)) ||
                    (dc.PoNumber != null && dc.PoNumber.ToLower().Contains(term)));
            }

            var totalCount = await query.CountAsync();
            var items = await query
                .OrderByDescending(dc => dc.ChallanNumber)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .ToListAsync();

            return (items, totalCount);
        }

        public async Task<DeliveryChallan?> GetByIdAsync(int id)
        {
            return await _context.DeliveryChallans
                                 .Include(dc => dc.Items)
                                     .ThenInclude(i => i.ItemType)
                                 .Include(dc => dc.Client)
                                 .Include(dc => dc.Company)
                                 .FirstOrDefaultAsync(dc => dc.Id == id);
        }

        public async Task<DeliveryChallan> CreateDeliveryChallanAsync(DeliveryChallan deliveryChallan)
        {
            var company = await _context.Companies
                                        .FirstOrDefaultAsync(c => c.Id == deliveryChallan.CompanyId);

            if (company == null)
                throw new Exception("Company not found.");

            int nextNumber = company.CurrentChallanNumber > 0
                             ? company.CurrentChallanNumber + 1
                             : company.StartingChallanNumber;

            deliveryChallan.ChallanNumber = nextNumber;
            company.CurrentChallanNumber = nextNumber;

            _context.DeliveryChallans.Add(deliveryChallan);
            await _context.SaveChangesAsync();

            await _context.Entry(deliveryChallan).Reference(dc => dc.Client).LoadAsync();

            return deliveryChallan;
        }

        public async Task<DeliveryChallan> UpdateAsync(DeliveryChallan deliveryChallan)
        {
            _context.DeliveryChallans.Update(deliveryChallan);
            await _context.SaveChangesAsync();
            return deliveryChallan;
        }

        public async Task DeleteAsync(DeliveryChallan deliveryChallan)
        {
            _context.DeliveryChallans.Remove(deliveryChallan);
            await _context.SaveChangesAsync();
        }

        public async Task<DeliveryItem?> GetItemByIdAsync(int itemId)
        {
            return await _context.DeliveryItems
                                 .Include(i => i.DeliveryChallan)
                                 .FirstOrDefaultAsync(i => i.Id == itemId);
        }

        public async Task DeleteItemAsync(DeliveryItem item)
        {
            _context.DeliveryItems.Remove(item);
            await _context.SaveChangesAsync();
        }

        public async Task<List<DeliveryChallan>> GetPendingChallansByCompanyAsync(int companyId)
        {
            return await _context.DeliveryChallans
                                 .Include(dc => dc.Items)
                                     .ThenInclude(i => i.ItemType)
                                 .Include(dc => dc.Client)
                                 .Where(dc => dc.CompanyId == companyId && dc.Status == "Pending")
                                 .OrderBy(dc => dc.ChallanNumber)
                                 .ToListAsync();
        }

        public async Task<int> GetTotalCountAsync()
        {
            return await _context.DeliveryChallans.CountAsync();
        }

        public async Task<int> GetCountByCompanyAsync(int companyId)
        {
            return await _context.DeliveryChallans.CountAsync(dc => dc.CompanyId == companyId);
        }

        public async Task<bool> HasChallansForCompanyAsync(int companyId)
        {
            return await _context.DeliveryChallans.AnyAsync(dc => dc.CompanyId == companyId);
        }
    }
}
