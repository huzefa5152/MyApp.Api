using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    public interface ISupplierService
    {
        Task<IEnumerable<SupplierDto>> GetAllAsync();
        Task<IEnumerable<SupplierDto>> GetByCompanyAsync(int companyId);
        Task<SupplierDto?> GetByIdAsync(int id);
        Task<SupplierDto> CreateAsync(SupplierDto dto);

        /// <summary>
        /// Multi-company create — same shape as
        /// <see cref="IClientService.CreateForCompaniesAsync"/>. Picking
        /// 2+ companies auto-links the new rows into one Common Supplier
        /// group via EnsureGroup.
        /// </summary>
        Task<CreateSupplierBatchResultDto> CreateForCompaniesAsync(CreateSupplierBatchDto dto);

        /// <summary>
        /// Copy an existing supplier into one or more target companies.
        /// Mirror of <see cref="IClientService.CopyToCompaniesAsync"/>.
        /// </summary>
        Task<CreateSupplierBatchResultDto> CopyToCompaniesAsync(int sourceSupplierId, List<int> targetCompanyIds);

        Task<SupplierDto> UpdateAsync(SupplierDto dto);
        Task DeleteAsync(int id);
    }
}
