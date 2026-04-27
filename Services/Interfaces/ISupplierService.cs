using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    public interface ISupplierService
    {
        Task<IEnumerable<SupplierDto>> GetAllAsync();
        Task<IEnumerable<SupplierDto>> GetByCompanyAsync(int companyId);
        Task<SupplierDto?> GetByIdAsync(int id);
        Task<SupplierDto> CreateAsync(SupplierDto dto);
        Task<SupplierDto> UpdateAsync(SupplierDto dto);
        Task DeleteAsync(int id);
    }
}
