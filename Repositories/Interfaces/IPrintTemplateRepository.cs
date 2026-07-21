using MyApp.Api.Models;

namespace MyApp.Api.Repositories.Interfaces
{
    public interface IPrintTemplateRepository
    {
        // ── Print/export resolver + legacy (companyId, type) shims ──
        // Resolves the type's default (IsDefault first), falling back to the oldest
        // row, else null. The print pages and Excel exports key off this.
        Task<PrintTemplate?> GetByCompanyAndTypeAsync(int companyId, string templateType);

        // Upsert the type's default HTML body (legacy single-template editor save path).
        Task<PrintTemplate> UpsertAsync(int companyId, string templateType, string htmlContent, string? templateJson = null, string? editorMode = null);

        // Upsert the type's default Excel path (legacy upload shim).
        Task<PrintTemplate> UpsertExcelPathAsync(int companyId, string templateType, string excelPath, string? sheetName = null);

        // Export resolver: the type's default template that actually carries an Excel
        // file (default first, oldest Excel-bearing row as fallback). Excel export keys
        // off this.
        Task<PrintTemplate?> GetForExportAsync(int companyId, string templateType);

        // ── Scoped (multi-template) operations ──
        Task<List<PrintTemplate>> GetByCompanyAsync(int companyId);
        Task<PrintTemplate?> GetByIdAsync(int id);

        // Create a template in (companyId, type). Forces IsDefault when it is the first
        // template of that type; if isDefault is requested while a sibling default
        // exists, the sibling is cleared in the same transaction.
        Task<PrintTemplate> CreateAsync(int companyId, string templateType,
            string name, string htmlContent, string? templateJson, string? editorMode, bool isDefault);

        // Update name/content only — never changes the default flag.
        Task<PrintTemplate?> UpdateContentAsync(int id, string name, string htmlContent, string? templateJson, string? editorMode);

        // Make the template the default for its type (clears the sibling default).
        Task<bool> SetDefaultAsync(int id);

        // Delete the template; if it was the default, promote the most-recently updated
        // sibling. Returns the deleted row's ExcelTemplatePath (may be null) so the
        // caller can remove the on-disk file after the transaction commits.
        Task<string?> DeleteAsync(int id);

        Task SaveAsync();
    }
}
