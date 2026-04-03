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
                                 .Include(dc => dc.Client)
                                 .Where(dc => dc.CompanyId == companyId)
                                 .OrderBy(dc => dc.ChallanNumber)
                                 .ToListAsync();
        }

        public async Task<DeliveryChallan> CreateDeliveryChallanAsync(DeliveryChallan deliveryChallan)
        {
            var company = await _context.Companies
                                        .FirstOrDefaultAsync(c => c.Id == deliveryChallan.CompanyId);

            if (company == null)
                throw new Exception("Company not found.");

            // Generate next challan number
            int nextNumber = company.CurrentChallanNumber > 0
                             ? company.CurrentChallanNumber + 1
                             : company.StartingChallanNumber;

            deliveryChallan.ChallanNumber = nextNumber;

            // Update company's current challan number
            company.CurrentChallanNumber = nextNumber;

            _context.DeliveryChallans.Add(deliveryChallan);
            await _context.SaveChangesAsync();

            // Eager-load Client so the response includes ClientName
            await _context.Entry(deliveryChallan).Reference(dc => dc.Client).LoadAsync();

            return deliveryChallan;
        }
    }
}
