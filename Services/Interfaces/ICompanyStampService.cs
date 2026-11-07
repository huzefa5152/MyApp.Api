using MyApp.Api.Models;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// Every change to a company's stamps, for the Stamps tab and MCP alike. A stamp reached by id is
    /// only ever touched when its STORED company is the one named; the callers assert that company first.
    /// A null result means no such stamp in this company. A rejected image throws InvalidOperationException.
    /// </summary>
    public interface ICompanyStampService
    {
        Task<CompanyStamp> AddAsync(int companyId, IFormFile file, string? name);
        Task<CompanyStamp?> ReplaceImageAsync(int companyId, int id, IFormFile file);
        Task<CompanyStamp?> UpdateAsync(int companyId, int id, string? name, int? sortOrder);
        Task<CompanyStamp?> SetDefaultAsync(int companyId, int id);
        Task<CompanyStamp?> DeleteAsync(int companyId, int id);
    }
}
