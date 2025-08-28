using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    public interface ICompanyService
    {
        Task<IEnumerable<CompanyDto>> GetAllAsync();
        Task<CompanyDto?> GetByIdAsync(int id);
        Task<CompanyDto> CreateAsync(CreateCompanyDto dto);
        Task<CompanyDto?> UpdateAsync(int id, UpdateCompanyDto dto);
        Task DeleteAsync(int id);
    }
}