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
            // IsDemo challans live in the 900000+ range and are managed only
            // through the FBR Sandbox tab — they do NOT appear on the regular
            // Challans page.
            return await _context.DeliveryChallans
                                 .Include(dc => dc.Items)
                                     .ThenInclude(i => i.ItemType)
                                 .Include(dc => dc.Client)
                                 .Include(dc => dc.Company)
                                 .Include(dc => dc.Invoice)
                                 .Include(dc => dc.DuplicatedFrom)
                                 .Where(dc => dc.CompanyId == companyId && !dc.IsDemo)
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
                .Include(dc => dc.Company)
                .Include(dc => dc.Invoice)
                .Include(dc => dc.DuplicatedFrom)
                .Where(dc => dc.CompanyId == companyId && !dc.IsDemo);

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
                    (dc.PoNumber != null && dc.PoNumber.ToLower().Contains(term)) ||
                    dc.Items.Any(item => item.Description.ToLower().Contains(term) ||
                                          (item.ItemType != null && item.ItemType.Name.ToLower().Contains(term))));
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
                                 .Include(dc => dc.Invoice)
                                     .ThenInclude(inv => inv!.Items)
                                 .Include(dc => dc.DuplicatedFrom)
                                 .FirstOrDefaultAsync(dc => dc.Id == id);
        }

        public async Task<DeliveryChallan> CreateDeliveryChallanAsync(DeliveryChallan deliveryChallan)
        {
            // Wrap in transaction to prevent duplicate challan numbers from concurrent requests
            await using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                var company = await _context.Companies
                                            .FirstOrDefaultAsync(c => c.Id == deliveryChallan.CompanyId);

                if (company == null)
                    throw new KeyNotFoundException("Company not found.");

                // Use MAX(ChallanNumber) so a deleted trailing number is reused on the next
                // create (no gaps after deleting the last challan). If nothing exists yet
                // for this company, fall back to the configured StartingChallanNumber.
                //
                // EXCLUDE demo challans (FBR Sandbox) from the MAX — they live in
                // their own 900000+ range so a seeded sandbox would otherwise push
                // the next REAL challan number into the demo range and pollute the
                // operator's actual numbering sequence.
                bool isDemo = deliveryChallan.IsDemo;
                var maxExisting = await _context.DeliveryChallans
                                                .Where(c => c.CompanyId == deliveryChallan.CompanyId
                                                         && c.IsDemo == isDemo)
                                                .MaxAsync(c => (int?)c.ChallanNumber) ?? 0;

                int nextNumber = maxExisting > 0
                                 ? maxExisting + 1
                                 : company.StartingChallanNumber;

                deliveryChallan.ChallanNumber = nextNumber;
                // Don't touch the company's CurrentChallanNumber when seeding
                // demo data — that field reflects the LIVE business sequence.
                if (!isDemo)
                {
                    company.CurrentChallanNumber = nextNumber;
                }

                _context.DeliveryChallans.Add(deliveryChallan);
                await _context.SaveChangesAsync();

                await transaction.CommitAsync();

                await _context.Entry(deliveryChallan).Reference(dc => dc.Client).LoadAsync();

                return deliveryChallan;
            }
            catch
            {
                await transaction.RollbackAsync();
                throw;
            }
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
            // Both "Pending" (natively-created) and "Imported" (historical back-fill)
            // are billable — the bill-creation picker shows both populations.
            return await _context.DeliveryChallans
                                 .Include(dc => dc.Items)
                                     .ThenInclude(i => i.ItemType)
                                 .Include(dc => dc.Client)
                                 .Where(dc => dc.CompanyId == companyId
                                           && (dc.Status == "Pending" || dc.Status == "Imported"))
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

        public async Task<List<DeliveryChallan>> GetSetupRequiredChallansAsync(int companyId, int? clientId = null)
        {
            var query = _context.DeliveryChallans
                .Include(dc => dc.Company)
                .Include(dc => dc.Client)
                .Where(dc => dc.CompanyId == companyId && dc.Status == "Setup Required");

            if (clientId.HasValue)
                query = query.Where(dc => dc.ClientId == clientId.Value);

            return await query.ToListAsync();
        }

        public async Task<DeliveryChallan> CreateImportedChallanAsync(DeliveryChallan deliveryChallan)
        {
            // Intentionally does NOT bump Company.CurrentChallanNumber — the live
            // series must stay untouched when back-filling historical records.
            // Uniqueness is enforced by the caller (service layer); this method
            // only persists the row.
            _context.DeliveryChallans.Add(deliveryChallan);
            await _context.SaveChangesAsync();
            await _context.Entry(deliveryChallan).Reference(dc => dc.Client).LoadAsync();
            return deliveryChallan;
        }

        public async Task<bool> ChallanNumberExistsAsync(int companyId, int challanNumber)
        {
            return await _context.DeliveryChallans
                .AnyAsync(dc => dc.CompanyId == companyId && dc.ChallanNumber == challanNumber);
        }

        public async Task<DeliveryChallan> DuplicateAsync(DeliveryChallan source)
        {
            // Point every copy back to the original root, not to whichever
            // specific copy was clicked. Means "Duplicate of #1042" stays
            // truthful even when the second copy was made from the first copy.
            int rootId = source.DuplicatedFromId ?? source.Id;

            var clone = new DeliveryChallan
            {
                CompanyId = source.CompanyId,
                ChallanNumber = source.ChallanNumber, // intentionally reused
                ClientId = source.ClientId,
                PoNumber = source.PoNumber,
                PoDate = source.PoDate,
                IndentNo = source.IndentNo,
                DeliveryDate = source.DeliveryDate,
                Site = source.Site,
                // Reset to "Pending" regardless of source status. Imported
                // copies become Pending too — once duplicated they're a
                // freshly-billable unit, not a historical record.
                Status = "Pending",
                // Independent billing — copies must NOT inherit the source's
                // invoice. Each gets billed on its own.
                InvoiceId = null,
                IsImported = false,
                IsDemo = source.IsDemo,
                DuplicatedFromId = rootId,
                Items = source.Items.Select(i => new DeliveryItem
                {
                    ItemTypeId = i.ItemTypeId,
                    Description = i.Description,
                    Quantity = i.Quantity,
                    Unit = i.Unit
                }).ToList()
            };

            _context.DeliveryChallans.Add(clone);
            await _context.SaveChangesAsync();
            await _context.Entry(clone).Reference(dc => dc.Client).LoadAsync();
            await _context.Entry(clone).Reference(dc => dc.Company).LoadAsync();
            await _context.Entry(clone).Reference(dc => dc.DuplicatedFrom).LoadAsync();
            return clone;
        }

        public async Task<HashSet<int>> GetExistingChallanNumbersAsync(int companyId, IEnumerable<int> candidateNumbers)
        {
            var list = candidateNumbers?.Where(n => n > 0).Distinct().ToList() ?? new List<int>();
            if (list.Count == 0) return new HashSet<int>();

            var hits = await _context.DeliveryChallans
                .Where(dc => dc.CompanyId == companyId && list.Contains(dc.ChallanNumber))
                .Select(dc => dc.ChallanNumber)
                .ToListAsync();
            return hits.ToHashSet();
        }
    }
}
