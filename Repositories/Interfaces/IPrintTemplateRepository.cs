using MyApp.Api.Models;

namespace MyApp.Api.Repositories.Interfaces
{
    public interface IPrintTemplateRepository
    {
        // ── Print/export resolver + legacy (companyId, type) shims ──
        // Resolves the COMPANY-LEVEL default (DivisionId == null && IsDefault),
        // falling back to the oldest company-level row, else null. The print
        // pages and Excel exports key off this — documents aren't division-tagged.
        Task<PrintTemplate?> GetByCompanyAndTypeAsync(int companyId, string templateType);

        // Upsert the company-level default's HTML body (legacy editor save path).
        Task<PrintTemplate> UpsertAsync(int companyId, string templateType, string htmlContent, string? templateJson = null, string? editorMode = null);

        // Upsert the company-level default's Excel path (legacy upload shim).
        Task<PrintTemplate> UpsertExcelPathAsync(int companyId, string templateType, string excelPath, string? sheetName = null);

        // Division-aware export resolver: when the document carries a division,
        // prefer that division scope's default template; otherwise (or if the
        // division has no template of this type) fall back to the company-level
        // default. This is what division-aware Excel export keys off.
        Task<PrintTemplate?> GetForExportAsync(int companyId, int? divisionId, string templateType);

        // ── Scoped (multi-template) operations ──
        Task<List<PrintTemplate>> GetByCompanyAsync(int companyId);
        Task<PrintTemplate?> GetByIdAsync(int id);

        // Create a template in (companyId, divisionId, type). Forces IsDefault when it
        // is the first template in that scope; if isDefault is requested while a sibling
        // default exists, the sibling is cleared in the same transaction. Caller must
        // have validated divisionId belongs to companyId.
        Task<PrintTemplate> CreateAsync(int companyId, int? divisionId, string templateType,
            string name, string htmlContent, string? templateJson, string? editorMode, bool isDefault);

        // Update name/content only — never changes scope or default flag.
        Task<PrintTemplate?> UpdateContentAsync(int id, string name, string htmlContent, string? templateJson, string? editorMode);

        // Make the template the default for its scope (clears the sibling default).
        Task<bool> SetDefaultAsync(int id);

        // Delete the template; if it was the scope default, promote the most-recently
        // updated sibling. Returns the deleted row's ExcelTemplatePath (may be null) so
        // the caller can remove the on-disk file after the transaction commits.
        Task<string?> DeleteAsync(int id);

        Task SaveAsync();
    }
}
