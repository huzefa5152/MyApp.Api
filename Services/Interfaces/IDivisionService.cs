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
    }
}
