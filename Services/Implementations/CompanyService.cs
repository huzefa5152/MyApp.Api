using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class CompanyService : ICompanyService
    {
        private readonly ICompanyRepository _repository;
        private readonly IDeliveryChallanRepository _challanRepo;
        private readonly IInvoiceRepository _invoiceRepo;
        private readonly AppDbContext _context;

        public CompanyService(ICompanyRepository repository, IDeliveryChallanRepository challanRepo, IInvoiceRepository invoiceRepo, AppDbContext context)
        {
            _repository = repository;
            _challanRepo = challanRepo;
            _invoiceRepo = invoiceRepo;
            _context = context;
        }

        private static CompanyDto ToDto(Company c, bool hasChallans = false, bool hasInvoices = false) => new()
        {
            Id = c.Id,
            Name = c.Name,
            BrandName = c.BrandName,
            LogoPath = c.LogoPath,
            FullAddress = c.FullAddress,
            Phone = c.Phone,
            NTN = c.NTN,
            STRN = c.STRN,
            StartingChallanNumber = c.StartingChallanNumber,
            CurrentChallanNumber = c.CurrentChallanNumber,
            StartingInvoiceNumber = c.StartingInvoiceNumber,
            CurrentInvoiceNumber = c.CurrentInvoiceNumber,
            HasChallans = hasChallans,
            HasInvoices = hasInvoices
        };

        public async Task<IEnumerable<CompanyDto>> GetAllAsync()
        {
            var companies = (await _repository.GetAllAsync()).ToList();
            var result = new List<CompanyDto>();
            foreach (var c in companies)
            {
                var hasChallans = await _challanRepo.HasChallansForCompanyAsync(c.Id);
                var hasInvoices = await _invoiceRepo.HasInvoicesForCompanyAsync(c.Id);
                result.Add(ToDto(c, hasChallans, hasInvoices));
            }
            return result;
        }

        public async Task<CompanyDto?> GetByIdAsync(int id)
        {
            var company = await _repository.GetByIdAsync(id);
            if (company == null) return null;
            var hasChallans = await _challanRepo.HasChallansForCompanyAsync(company.Id);
            var hasInvoices = await _invoiceRepo.HasInvoicesForCompanyAsync(company.Id);
            return ToDto(company, hasChallans, hasInvoices);
        }

        public async Task<CompanyDto> CreateAsync(CreateCompanyDto dto)
        {
            if (await _repository.ExistsByNameAsync(dto.Name))
                throw new InvalidOperationException($"A company with the name '{dto.Name}' already exists.");

            var company = new Company
            {
                Name = dto.Name,
                BrandName = dto.BrandName,
                FullAddress = dto.FullAddress,
                Phone = dto.Phone,
                NTN = dto.NTN,
                STRN = dto.STRN,
                StartingChallanNumber = dto.StartingChallanNumber,
                CurrentChallanNumber = 0,
                StartingInvoiceNumber = dto.StartingInvoiceNumber,
                CurrentInvoiceNumber = 0
            };

            var created = await _repository.AddAsync(company);
            return ToDto(created);
        }

        public async Task<CompanyDto?> UpdateAsync(int id, UpdateCompanyDto dto)
        {
            var company = await _repository.GetByIdAsync(id);
            if (company == null) return null;

            // Check uniqueness excluding current company id
            if (await _repository.ExistsByNameAsync(dto.Name, id))
                throw new InvalidOperationException($"A company with the name '{dto.Name}' already exists.");

            company.Name = dto.Name;
            company.BrandName = dto.BrandName;
            company.FullAddress = dto.FullAddress;
            company.Phone = dto.Phone;
            company.NTN = dto.NTN;
            company.STRN = dto.STRN;
            if (dto.LogoPath != null) company.LogoPath = dto.LogoPath;

            // Only allow changing starting challan number if no challans exist
            var hasChallans = await _challanRepo.HasChallansForCompanyAsync(id);
            if (!hasChallans)
            {
                company.StartingChallanNumber = dto.StartingChallanNumber;
                company.CurrentChallanNumber = 0;
            }

            // Only allow changing starting invoice number if no invoices exist
            var hasInvoices = await _invoiceRepo.HasInvoicesForCompanyAsync(id);
            if (!hasInvoices)
            {
                company.StartingInvoiceNumber = dto.StartingInvoiceNumber;
                company.CurrentInvoiceNumber = 0;
            }

            var updated = await _repository.UpdateAsync(company);
            return ToDto(updated, hasChallans, hasInvoices);
        }

        public async Task DeleteAsync(int id)
        {
            var company = await _repository.GetByIdAsync(id);
            if (company == null) throw new KeyNotFoundException("Company not found");

            // Cascade delete all related data (SQL Server doesn't allow multiple cascade paths)
            // Order: unlink challans from invoices → delete invoices → delete challans → delete clients → delete company

            // 1. Unlink challans from invoices
            await _context.DeliveryChallans
                .Where(dc => dc.CompanyId == id && dc.InvoiceId != null)
                .ExecuteUpdateAsync(s => s.SetProperty(dc => dc.InvoiceId, (int?)null));

            // 2. Delete invoice items, then invoices
            var invoiceIds = await _context.Invoices.Where(i => i.CompanyId == id).Select(i => i.Id).ToListAsync();
            if (invoiceIds.Count > 0)
            {
                await _context.InvoiceItems.Where(ii => invoiceIds.Contains(ii.InvoiceId)).ExecuteDeleteAsync();
                await _context.Invoices.Where(i => i.CompanyId == id).ExecuteDeleteAsync();
            }

            // 3. Delete delivery items, then challans
            var challanIds = await _context.DeliveryChallans.Where(dc => dc.CompanyId == id).Select(dc => dc.Id).ToListAsync();
            if (challanIds.Count > 0)
            {
                await _context.DeliveryItems.Where(di => challanIds.Contains(di.DeliveryChallanId)).ExecuteDeleteAsync();
                await _context.DeliveryChallans.Where(dc => dc.CompanyId == id).ExecuteDeleteAsync();
            }

            // 4. Delete clients
            await _context.Clients.Where(c => c.CompanyId == id).ExecuteDeleteAsync();

            // 5. Delete print templates (already CASCADE in DB, but be explicit)
            await _context.PrintTemplates.Where(pt => pt.CompanyId == id).ExecuteDeleteAsync();

            // 6. Delete the company
            await _repository.DeleteAsync(company);
        }
    }
}
