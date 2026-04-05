using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
using MyApp.Api.Repositories.Interfaces;

namespace MyApp.Api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class PrintTemplatesController : ControllerBase
    {
        private readonly IPrintTemplateRepository _repo;
        public PrintTemplatesController(IPrintTemplateRepository repo) => _repo = repo;

        [HttpGet("company/{companyId}")]
        public async Task<IActionResult> GetByCompany(int companyId)
        {
            var templates = await _repo.GetByCompanyAsync(companyId);
            return Ok(templates.Select(t => new PrintTemplateDto
            {
                Id = t.Id,
                CompanyId = t.CompanyId,
                TemplateType = t.TemplateType,
                HtmlContent = t.HtmlContent,
                UpdatedAt = t.UpdatedAt
            }));
        }

        [HttpGet("company/{companyId}/{templateType}")]
        public async Task<IActionResult> GetByCompanyAndType(int companyId, string templateType)
        {
            var t = await _repo.GetByCompanyAndTypeAsync(companyId, templateType);
            if (t == null) return NotFound();
            return Ok(new PrintTemplateDto
            {
                Id = t.Id,
                CompanyId = t.CompanyId,
                TemplateType = t.TemplateType,
                HtmlContent = t.HtmlContent,
                UpdatedAt = t.UpdatedAt
            });
        }

        [HttpPut("company/{companyId}/{templateType}")]
        public async Task<IActionResult> Upsert(int companyId, string templateType, [FromBody] UpsertPrintTemplateDto dto)
        {
            var validTypes = new[] { "Challan", "Bill", "TaxInvoice" };
            if (!validTypes.Contains(templateType))
                return BadRequest(new { error = "Invalid template type. Use: Challan, Bill, or TaxInvoice" });

            var t = await _repo.UpsertAsync(companyId, templateType, dto.HtmlContent);
            return Ok(new PrintTemplateDto
            {
                Id = t.Id,
                CompanyId = t.CompanyId,
                TemplateType = t.TemplateType,
                HtmlContent = t.HtmlContent,
                UpdatedAt = t.UpdatedAt
            });
        }
    }
}
