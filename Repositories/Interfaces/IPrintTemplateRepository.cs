using MyApp.Api.Models;

namespace MyApp.Api.Repositories.Interfaces
{
    public interface IPrintTemplateRepository
    {
        Task<PrintTemplate?> GetByCompanyAndTypeAsync(int companyId, string templateType);
        Task<List<PrintTemplate>> GetByCompanyAsync(int companyId);
        Task<PrintTemplate> UpsertAsync(int companyId, string templateType, string htmlContent, string? templateJson = null, string? editorMode = null);
        Task<PrintTemplate> UpsertExcelPathAsync(int companyId, string templateType, string excelPath);
        Task SaveAsync();
    }
}
