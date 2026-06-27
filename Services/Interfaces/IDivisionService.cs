using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    public interface IDivisionService
    {
        Task<List<DivisionDto>> GetByCompanyAsync(int companyId);
        Task<DivisionDto?> GetByIdAsync(int id);
        Task<DivisionDto> CreateAsync(int companyId, DivisionDto dto);
        Task<DivisionDto?> UpdateAsync(int id, DivisionDto dto);
        Task<bool> DeleteAsync(int id);
        /// <summary>Persist a new logo path on the division (called by the
        /// POST /divisions/{id}/logo upload endpoint after the file is saved).</summary>
        Task<DivisionDto?> SetLogoAsync(int id, string logoPath);
    }
}
