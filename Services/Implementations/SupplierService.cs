using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class SupplierService : ISupplierService
    {
        private readonly ISupplierRepository _repo;
        private readonly ISupplierGroupService _groupService;
        private readonly AppDbContext _context;
        private readonly ILogger<SupplierService> _logger;

        public SupplierService(ISupplierRepository repo, ISupplierGroupService groupService, AppDbContext context, ILogger<SupplierService> logger)
        {
            _repo = repo;
            _groupService = groupService;
            _context = context;
            _logger = logger;
        }

        private static SupplierDto ToDto(Supplier s, bool hasPurchaseBills = false) => new()
        {
            Id = s.Id,
            Name = s.Name,
            Address = s.Address,
            Phone = s.Phone,
            Email = s.Email,
            NTN = s.NTN,
            STRN = s.STRN,
            Site = s.Site,
            RegistrationType = s.RegistrationType,
            CNIC = s.CNIC,
            FbrProvinceCode = s.FbrProvinceCode,
            CompanyId = s.CompanyId,
            SupplierGroupId = s.SupplierGroupId,
            HasPurchaseBills = hasPurchaseBills,
            CreatedAt = s.CreatedAt,
        };

        public async Task<IEnumerable<SupplierDto>> GetAllAsync()
        {
            var suppliers = (await _repo.GetAllAsync()).ToList();
            var ids = suppliers.Select(s => s.Id).ToList();
            var hasMap = await _repo.HasPurchaseBillsForSuppliersAsync(ids);
            return suppliers.Select(s => ToDto(s, hasMap.GetValueOrDefault(s.Id)));
        }

        public async Task<IEnumerable<SupplierDto>> GetByCompanyAsync(int companyId)
        {
            var suppliers = (await _repo.GetByCompanyAsync(companyId)).ToList();
            var ids = suppliers.Select(s => s.Id).ToList();
            var hasMap = await _repo.HasPurchaseBillsForSuppliersAsync(ids);
            return suppliers.Select(s => ToDto(s, hasMap.GetValueOrDefault(s.Id)));
        }

        public async Task<SupplierDto?> GetByIdAsync(int id)
        {
            var s = await _repo.GetByIdAsync(id);
            if (s == null) return null;
            var hasBills = await _repo.HasPurchaseBillsAsync(s.Id);
            return ToDto(s, hasBills);
        }

        public async Task<SupplierDto> CreateAsync(SupplierDto dto)
        {
            if (await _repo.ExistsWithNameAsync(dto.Name, dto.CompanyId))
                throw new InvalidOperationException("Supplier with this name already exists for this company.");

            var supplier = new Supplier
            {
                Name = dto.Name,
                Address = dto.Address,
                Phone = dto.Phone,
                Email = dto.Email,
                NTN = dto.NTN,
                STRN = dto.STRN,
                Site = dto.Site,
                RegistrationType = dto.RegistrationType,
                CNIC = dto.CNIC,
                FbrProvinceCode = dto.FbrProvinceCode,
                CompanyId = dto.CompanyId,
                CreatedAt = DateTime.UtcNow,
            };

            var created = await _repo.CreateAsync(supplier);

            // Attach to a Common Supplier group — find-or-create by NTN
            // (or normalised name fallback). Same defensive try/catch as
            // ClientService: grouping is a convenience layer, must never
            // break the per-company create.
            try
            {
                await _groupService.EnsureGroupForSupplierAsync(created);
                await _context.SaveChangesAsync();
            }
            catch { /* see ClientService.CreateAsync */ }

            return ToDto(created);
        }

        public async Task<CreateSupplierBatchResultDto> CreateForCompaniesAsync(CreateSupplierBatchDto dto)
        {
            var result = new CreateSupplierBatchResultDto();
            if (dto.CompanyIds == null || dto.CompanyIds.Count == 0)
                throw new InvalidOperationException("At least one company must be selected.");

            var distinctIds = dto.CompanyIds.Distinct().ToList();
            var companyNames = await _context.Companies
                .Where(c => distinctIds.Contains(c.Id))
                .ToDictionaryAsync(c => c.Id, c => c.Name);

            await using var tx = await _context.Database.BeginTransactionAsync();
            try
            {
                foreach (var companyId in distinctIds)
                {
                    if (!companyNames.TryGetValue(companyId, out var companyName))
                    {
                        result.SkippedReasons.Add($"Company id={companyId} not found.");
                        continue;
                    }

                    if (await _repo.ExistsWithNameAsync(dto.Name, companyId))
                    {
                        result.SkippedReasons.Add(
                            $"{companyName}: a supplier named '{dto.Name}' already exists; skipped.");
                        continue;
                    }

                    var supplier = new Supplier
                    {
                        Name = dto.Name,
                        Address = dto.Address,
                        Phone = dto.Phone,
                        Email = dto.Email,
                        NTN = dto.NTN,
                        STRN = dto.STRN,
                        Site = dto.Site,
                        RegistrationType = dto.RegistrationType,
                        CNIC = dto.CNIC,
                        FbrProvinceCode = dto.FbrProvinceCode,
                        CompanyId = companyId,
                        CreatedAt = DateTime.UtcNow,
                    };
                    var created = await _repo.CreateAsync(supplier);

                    try
                    {
                        var grp = await _groupService.EnsureGroupForSupplierAsync(created);
                        await _context.SaveChangesAsync();
                        result.SupplierGroupId = grp.Id;
                    }
                    catch { /* grouping failure must not block create */ }

                    result.Created.Add(ToDto(created));
                }

                await tx.CommitAsync();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "SupplierService: transaction rolled back");
                await tx.RollbackAsync();
                throw;
            }

            return result;
        }

        public async Task<CreateSupplierBatchResultDto> CopyToCompaniesAsync(int sourceSupplierId, List<int> targetCompanyIds)
        {
            if (targetCompanyIds == null || targetCompanyIds.Count == 0)
                throw new InvalidOperationException("At least one target company must be selected.");

            var source = await _repo.GetByIdAsync(sourceSupplierId)
                ?? throw new KeyNotFoundException("Source supplier not found.");

            var cleanTargets = targetCompanyIds
                .Where(id => id != source.CompanyId)
                .Distinct()
                .ToList();

            if (cleanTargets.Count == 0)
                throw new InvalidOperationException("No valid target companies to copy into (cannot copy a supplier into its own company).");

            // Same delegation pattern as ClientService.CopyToCompaniesAsync:
            // CreateForCompaniesAsync already handles transactions, name
            // collisions, and EnsureGroupForSupplierAsync auto-linking, so
            // every new row lands on the same SupplierGroup as the source.
            var batch = new CreateSupplierBatchDto
            {
                Name = source.Name,
                Address = source.Address,
                Phone = source.Phone,
                Email = source.Email,
                NTN = source.NTN,
                STRN = source.STRN,
                Site = source.Site,
                RegistrationType = source.RegistrationType,
                CNIC = source.CNIC,
                FbrProvinceCode = source.FbrProvinceCode,
                CompanyIds = cleanTargets,
            };
            return await CreateForCompaniesAsync(batch);
        }

        public async Task<SupplierDto> UpdateAsync(SupplierDto dto)
        {
            if (dto.Id == null) throw new ArgumentException("Supplier ID is required for update.");

            var supplier = await _repo.GetByIdAsync(dto.Id.Value);
            if (supplier == null) throw new KeyNotFoundException("Supplier not found.");

            if (await _repo.ExistsWithNameAsync(dto.Name, supplier.CompanyId, dto.Id))
                throw new InvalidOperationException("Supplier with this name already exists for this company.");

            supplier.Name = dto.Name;
            supplier.Address = dto.Address;
            supplier.Phone = dto.Phone;
            supplier.Email = dto.Email;
            supplier.NTN = dto.NTN;
            supplier.STRN = dto.STRN;
            supplier.Site = dto.Site;
            supplier.RegistrationType = dto.RegistrationType;
            supplier.CNIC = dto.CNIC;
            supplier.FbrProvinceCode = dto.FbrProvinceCode;

            var hasBills = await _repo.HasPurchaseBillsAsync(supplier.Id);
            await _repo.UpdateAsync(supplier);

            // Re-evaluate Common Supplier grouping. NTN / Name might
            // have just changed, which moves the supplier from one
            // group to another (or creates a new group). Same
            // defensive try/catch as Create.
            try
            {
                await _groupService.EnsureGroupForSupplierAsync(supplier);
                await _context.SaveChangesAsync();
            }
            catch { /* see CreateAsync */ }

            return ToDto(supplier, hasBills);
        }

        public async Task DeleteAsync(int id)
        {
            var supplier = await _repo.GetByIdAsync(id);
            if (supplier == null) return;

            // Suppliers with bookings can't be deleted — same safety stance
            // as Clients with invoices, but tighter: no cascade. The
            // operator must remove the PurchaseBills first if they really
            // mean to delete the supplier (and that itself reverses any
            // Stock IN movements those bills emitted).
            if (await _repo.HasPurchaseBillsAsync(id))
                throw new InvalidOperationException("Cannot delete supplier — purchase bills exist against this supplier. Delete the bills first.");

            await _repo.DeleteAsync(supplier);
        }
    }
}
