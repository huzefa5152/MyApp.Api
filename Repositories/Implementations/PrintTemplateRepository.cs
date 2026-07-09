using System.Data;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;

namespace MyApp.Api.Repositories.Implementations
{
    public class PrintTemplateRepository : IPrintTemplateRepository
    {
        private readonly AppDbContext _ctx;
        public PrintTemplateRepository(AppDbContext ctx) => _ctx = ctx;

        // Rows in a single (CompanyId, DivisionId, TemplateType) scope. The null
        // branch is spelled out so EF emits `[DivisionId] IS NULL` (not `= @p`,
        // which never matches a NULL column) for the company-level scope.
        private IQueryable<PrintTemplate> ScopeQuery(int companyId, int? divisionId, string templateType)
        {
            var q = _ctx.PrintTemplates.Where(pt => pt.CompanyId == companyId && pt.TemplateType == templateType);
            return divisionId.HasValue
                ? q.Where(pt => pt.DivisionId == divisionId.Value)
                : q.Where(pt => pt.DivisionId == null);
        }

        // ── Print/export resolver + legacy shims ──

        public async Task<PrintTemplate?> GetByCompanyAndTypeAsync(int companyId, string templateType)
        {
            // Company-level default first (IsDefault desc), oldest company-level row as fallback.
            return await _ctx.PrintTemplates
                .Where(pt => pt.CompanyId == companyId && pt.TemplateType == templateType && pt.DivisionId == null)
                .OrderByDescending(pt => pt.IsDefault)
                .ThenBy(pt => pt.Id)
                .FirstOrDefaultAsync();
        }

        public async Task<PrintTemplate?> GetForExportAsync(int companyId, int? divisionId, string templateType)
        {
            // Prefer the document's division scope: its default first, oldest row
            // as fallback. Only a template that actually has an Excel file on it
            // counts for export resolution — a division may have an HTML-only
            // template while its Excel layout still lives at company level.
            if (divisionId.HasValue)
            {
                var div = await ScopeQuery(companyId, divisionId, templateType)
                    .Where(pt => pt.ExcelTemplatePath != null)
                    .OrderByDescending(pt => pt.IsDefault)
                    .ThenBy(pt => pt.Id)
                    .FirstOrDefaultAsync();
                if (div != null) return div;
            }
            // Company-level fallback (mirrors GetByCompanyAndTypeAsync ordering).
            return await ScopeQuery(companyId, null, templateType)
                .Where(pt => pt.ExcelTemplatePath != null)
                .OrderByDescending(pt => pt.IsDefault)
                .ThenBy(pt => pt.Id)
                .FirstOrDefaultAsync();
        }

        public async Task<PrintTemplate> UpsertAsync(int companyId, string templateType, string htmlContent, string? templateJson = null, string? editorMode = null)
        {
            var existing = await GetByCompanyAndTypeAsync(companyId, templateType);

            if (existing != null)
            {
                existing.HtmlContent = htmlContent;
                existing.TemplateJson = templateJson;
                existing.EditorMode = editorMode;
                existing.UpdatedAt = DateTime.UtcNow;
            }
            else
            {
                existing = new PrintTemplate
                {
                    CompanyId = companyId,
                    DivisionId = null,
                    TemplateType = templateType,
                    Name = "Default",
                    IsDefault = true,
                    HtmlContent = htmlContent,
                    TemplateJson = templateJson,
                    EditorMode = editorMode,
                    UpdatedAt = DateTime.UtcNow
                };
                _ctx.PrintTemplates.Add(existing);
            }

            await _ctx.SaveChangesAsync();
            return existing;
        }

        public async Task<PrintTemplate> UpsertExcelPathAsync(int companyId, string templateType, string excelPath, string? sheetName = null)
        {
            var existing = await GetByCompanyAndTypeAsync(companyId, templateType);

            if (existing != null)
            {
                existing.ExcelTemplatePath = excelPath;
                if (sheetName != null) existing.ExcelSheetName = sheetName;
                existing.UpdatedAt = DateTime.UtcNow;
            }
            else
            {
                existing = new PrintTemplate
                {
                    CompanyId = companyId,
                    DivisionId = null,
                    TemplateType = templateType,
                    Name = "Default",
                    IsDefault = true,
                    HtmlContent = "",
                    ExcelTemplatePath = excelPath,
                    ExcelSheetName = sheetName,
                    UpdatedAt = DateTime.UtcNow
                };
                _ctx.PrintTemplates.Add(existing);
            }

            await _ctx.SaveChangesAsync();
            return existing;
        }

        // ── Scoped (multi-template) operations ──

        public async Task<List<PrintTemplate>> GetByCompanyAsync(int companyId)
        {
            return await _ctx.PrintTemplates
                .AsNoTracking()
                .Include(pt => pt.Division)
                .Where(pt => pt.CompanyId == companyId)
                .OrderBy(pt => pt.TemplateType)
                .ThenBy(pt => pt.DivisionId)   // NULL (company-level) sorts first on SQL Server
                .ThenBy(pt => pt.Name)
                .ToListAsync();
        }

        public async Task<PrintTemplate?> GetByIdAsync(int id)
        {
            // Tracked (no AsNoTracking): the id-based Excel upload/delete/sheet-pin
            // endpoints load via this method, mutate, then SaveAsync.
            return await _ctx.PrintTemplates
                .Include(pt => pt.Division)
                .FirstOrDefaultAsync(pt => pt.Id == id);
        }

        public async Task<PrintTemplate> CreateAsync(int companyId, int? divisionId, string templateType,
            string name, string htmlContent, string? templateJson, string? editorMode, bool isDefault)
        {
            await using var tx = await _ctx.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            try
            {
                bool firstInScope = !await ScopeQuery(companyId, divisionId, templateType).AnyAsync();
                bool makeDefault = isDefault || firstInScope;

                if (makeDefault)
                {
                    // Clear the existing default in this scope first (filtered unique
                    // index allows only one IsDefault row per scope).
                    var current = await ScopeQuery(companyId, divisionId, templateType)
                        .Where(pt => pt.IsDefault)
                        .ToListAsync();
                    if (current.Count > 0)
                    {
                        foreach (var c in current) c.IsDefault = false;
                        await _ctx.SaveChangesAsync();
                    }
                }

                var t = new PrintTemplate
                {
                    CompanyId = companyId,
                    DivisionId = divisionId,
                    TemplateType = templateType,
                    Name = string.IsNullOrWhiteSpace(name) ? "Untitled" : name.Trim(),
                    IsDefault = makeDefault,
                    HtmlContent = htmlContent,
                    TemplateJson = templateJson,
                    EditorMode = editorMode,
                    UpdatedAt = DateTime.UtcNow
                };
                _ctx.PrintTemplates.Add(t);
                await _ctx.SaveChangesAsync();
                await tx.CommitAsync();
                return t;
            }
            catch
            {
                await tx.RollbackAsync();
                throw;
            }
        }

        public async Task<PrintTemplate?> UpdateContentAsync(int id, string name, string htmlContent, string? templateJson, string? editorMode)
        {
            var t = await _ctx.PrintTemplates.FirstOrDefaultAsync(pt => pt.Id == id);
            if (t == null) return null;

            t.Name = string.IsNullOrWhiteSpace(name) ? t.Name : name.Trim();
            t.HtmlContent = htmlContent;
            t.TemplateJson = templateJson;
            t.EditorMode = editorMode;
            t.UpdatedAt = DateTime.UtcNow;
            await _ctx.SaveChangesAsync();
            return t;
        }

        public async Task<bool> SetDefaultAsync(int id)
        {
            await using var tx = await _ctx.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            try
            {
                var target = await _ctx.PrintTemplates.FirstOrDefaultAsync(pt => pt.Id == id);
                if (target == null) { await tx.RollbackAsync(); return false; }
                if (target.IsDefault) { await tx.CommitAsync(); return true; }

                // Clear the current default(s) in the same scope, save, THEN set the
                // target — two saves so the filtered unique index never sees two
                // IsDefault rows mid-update.
                var current = await ScopeQuery(target.CompanyId, target.DivisionId, target.TemplateType)
                    .Where(pt => pt.IsDefault && pt.Id != target.Id)
                    .ToListAsync();
                if (current.Count > 0)
                {
                    foreach (var c in current) c.IsDefault = false;
                    await _ctx.SaveChangesAsync();
                }

                target.IsDefault = true;
                target.UpdatedAt = DateTime.UtcNow;
                await _ctx.SaveChangesAsync();
                await tx.CommitAsync();
                return true;
            }
            catch
            {
                await tx.RollbackAsync();
                throw;
            }
        }

        public async Task<string?> DeleteAsync(int id)
        {
            await using var tx = await _ctx.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            try
            {
                var t = await _ctx.PrintTemplates.FirstOrDefaultAsync(pt => pt.Id == id);
                if (t == null) { await tx.RollbackAsync(); return null; }

                var path = t.ExcelTemplatePath;
                bool wasDefault = t.IsDefault;
                int companyId = t.CompanyId;
                int? divisionId = t.DivisionId;
                string type = t.TemplateType;

                _ctx.PrintTemplates.Remove(t);
                await _ctx.SaveChangesAsync();

                if (wasDefault)
                {
                    // Promote the most-recently-updated remaining sibling so the scope
                    // keeps a default (if any siblings remain).
                    var promote = await ScopeQuery(companyId, divisionId, type)
                        .OrderByDescending(pt => pt.UpdatedAt)
                        .ThenByDescending(pt => pt.Id)
                        .FirstOrDefaultAsync();
                    if (promote != null)
                    {
                        promote.IsDefault = true;
                        await _ctx.SaveChangesAsync();
                    }
                }

                await tx.CommitAsync();
                return path;
            }
            catch
            {
                await tx.RollbackAsync();
                throw;
            }
        }

        public async Task SaveAsync()
        {
            await _ctx.SaveChangesAsync();
        }
    }
}
