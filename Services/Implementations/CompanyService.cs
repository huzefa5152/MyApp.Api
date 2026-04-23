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
        private readonly IDeliveryChallanService _challanService;
        private readonly AppDbContext _context;

        public CompanyService(ICompanyRepository repository, IDeliveryChallanRepository challanRepo, IInvoiceRepository invoiceRepo, IDeliveryChallanService challanService, AppDbContext context)
        {
            _repository = repository;
            _challanRepo = challanRepo;
            _invoiceRepo = invoiceRepo;
            _challanService = challanService;
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
            CNIC = c.CNIC,
            STRN = c.STRN,
            StartingChallanNumber = c.StartingChallanNumber,
            CurrentChallanNumber = c.CurrentChallanNumber,
            StartingInvoiceNumber = c.StartingInvoiceNumber,
            CurrentInvoiceNumber = c.CurrentInvoiceNumber,
            InvoiceNumberPrefix = c.InvoiceNumberPrefix,
            FbrProvinceCode = c.FbrProvinceCode,
            FbrBusinessActivity = c.FbrBusinessActivity,
            FbrSector = c.FbrSector,
            FbrEnvironment = c.FbrEnvironment,
            HasFbrToken = !string.IsNullOrEmpty(c.FbrToken),
            HasChallans = hasChallans,
            HasInvoices = hasInvoices,
            FbrDefaultSaleType = c.FbrDefaultSaleType,
            FbrDefaultUOM = c.FbrDefaultUOM,
            FbrDefaultPaymentModeRegistered = c.FbrDefaultPaymentModeRegistered,
            FbrDefaultPaymentModeUnregistered = c.FbrDefaultPaymentModeUnregistered
        };

        public async Task<IEnumerable<CompanyDto>> GetAllAsync()
        {
            var companies = (await _repository.GetAllAsync()).ToList();
            var companyIds = companies.Select(c => c.Id).ToList();

            // Batch queries instead of N+1
            var companiesWithChallans = await _context.DeliveryChallans
                .Where(dc => companyIds.Contains(dc.CompanyId))
                .Select(dc => dc.CompanyId)
                .Distinct()
                .ToListAsync();

            var companiesWithInvoices = await _context.Invoices
                .Where(i => companyIds.Contains(i.CompanyId))
                .Select(i => i.CompanyId)
                .Distinct()
                .ToListAsync();

            var challanSet = new HashSet<int>(companiesWithChallans);
            var invoiceSet = new HashSet<int>(companiesWithInvoices);

            return companies.Select(c => ToDto(c, challanSet.Contains(c.Id), invoiceSet.Contains(c.Id))).ToList();
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
                CNIC = dto.CNIC,
                STRN = dto.STRN,
                StartingChallanNumber = dto.StartingChallanNumber,
                CurrentChallanNumber = 0,
                StartingInvoiceNumber = dto.StartingInvoiceNumber,
                CurrentInvoiceNumber = 0,
                InvoiceNumberPrefix = dto.InvoiceNumberPrefix,
                FbrProvinceCode = dto.FbrProvinceCode,
                FbrBusinessActivity = dto.FbrBusinessActivity,
                FbrSector = dto.FbrSector,
                FbrToken = dto.FbrToken,
                FbrEnvironment = dto.FbrEnvironment,
                FbrDefaultSaleType = dto.FbrDefaultSaleType,
                FbrDefaultUOM = dto.FbrDefaultUOM,
                FbrDefaultPaymentModeRegistered = dto.FbrDefaultPaymentModeRegistered,
                FbrDefaultPaymentModeUnregistered = dto.FbrDefaultPaymentModeUnregistered
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
            company.CNIC = dto.CNIC;
            company.STRN = dto.STRN;
            if (dto.LogoPath != null) company.LogoPath = dto.LogoPath;

            // FBR fields (always updatable)
            company.InvoiceNumberPrefix = dto.InvoiceNumberPrefix;
            company.FbrProvinceCode = dto.FbrProvinceCode;
            company.FbrBusinessActivity = dto.FbrBusinessActivity;
            company.FbrSector = dto.FbrSector;
            company.FbrEnvironment = dto.FbrEnvironment;
            if (dto.FbrToken != null) company.FbrToken = dto.FbrToken;

            // Per-company FBR defaults — null is a valid "clear this default" signal
            company.FbrDefaultSaleType = dto.FbrDefaultSaleType;
            company.FbrDefaultUOM = dto.FbrDefaultUOM;
            company.FbrDefaultPaymentModeRegistered = dto.FbrDefaultPaymentModeRegistered;
            company.FbrDefaultPaymentModeUnregistered = dto.FbrDefaultPaymentModeUnregistered;

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

            // Re-evaluate "Setup Required" challans in case FBR fields are now complete
            await _challanService.ReEvaluateSetupRequiredAsync(id);

            return ToDto(updated, hasChallans, hasInvoices);
        }

        public async Task DeleteAsync(int id)
        {
            var company = await _repository.GetByIdAsync(id);
            if (company == null) throw new KeyNotFoundException("Company not found");

            // Cascade delete in a single transaction for atomicity
            await using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
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

                // 5. Delete print templates
                await _context.PrintTemplates.Where(pt => pt.CompanyId == id).ExecuteDeleteAsync();

                // 6. Delete the company
                await _repository.DeleteAsync(company);

                await transaction.CommitAsync();
            }
            catch
            {
                await transaction.RollbackAsync();
                throw;
            }
        }
    }
}
