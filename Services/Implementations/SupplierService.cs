using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class SupplierService : ISupplierService
    {
        private readonly ISupplierRepository _repo;

        public SupplierService(ISupplierRepository repo)
        {
            _repo = repo;
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
            return ToDto(created);
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
