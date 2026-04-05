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

        public async Task<PrintTemplate?> GetByCompanyAndTypeAsync(int companyId, string templateType)
        {
            return await _ctx.PrintTemplates
                .FirstOrDefaultAsync(pt => pt.CompanyId == companyId && pt.TemplateType == templateType);
        }

        public async Task<List<PrintTemplate>> GetByCompanyAsync(int companyId)
        {
            return await _ctx.PrintTemplates
                .Where(pt => pt.CompanyId == companyId)
                .OrderBy(pt => pt.TemplateType)
                .ToListAsync();
        }

        public async Task<PrintTemplate> UpsertAsync(int companyId, string templateType, string htmlContent)
        {
            var existing = await _ctx.PrintTemplates
                .FirstOrDefaultAsync(pt => pt.CompanyId == companyId && pt.TemplateType == templateType);

            if (existing != null)
            {
                existing.HtmlContent = htmlContent;
                existing.UpdatedAt = DateTime.UtcNow;
            }
            else
            {
                existing = new PrintTemplate
                {
                    CompanyId = companyId,
                    TemplateType = templateType,
                    HtmlContent = htmlContent,
                    UpdatedAt = DateTime.UtcNow
                };
                _ctx.PrintTemplates.Add(existing);
            }

            await _ctx.SaveChangesAsync();
            return existing;
        }
    }
}
