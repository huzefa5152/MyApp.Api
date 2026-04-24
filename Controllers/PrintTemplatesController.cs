using ClosedXML.Excel;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Middleware;
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

        private static PrintTemplateDto ToDto(Models.PrintTemplate t) => new()
        {
            Id = t.Id,
            CompanyId = t.CompanyId,
            TemplateType = t.TemplateType,
            HtmlContent = t.HtmlContent,
            TemplateJson = t.TemplateJson,
            EditorMode = t.EditorMode,
            HasExcelTemplate = !string.IsNullOrEmpty(t.ExcelTemplatePath) && System.IO.File.Exists(
                Path.Combine(Directory.GetCurrentDirectory(), t.ExcelTemplatePath.TrimStart('/'))),
            UpdatedAt = t.UpdatedAt
        };

        [HttpGet("company/{companyId}")]
        public async Task<IActionResult> GetByCompany(int companyId)
        {
            var templates = await _repo.GetByCompanyAsync(companyId);
            return Ok(templates.Select(ToDto));
        }

        [HttpGet("company/{companyId}/{templateType}")]
        public async Task<IActionResult> GetByCompanyAndType(int companyId, string templateType)
        {
            var t = await _repo.GetByCompanyAndTypeAsync(companyId, templateType);
            if (t == null) return NotFound();
            return Ok(ToDto(t));
        }

        [HttpPut("company/{companyId}/{templateType}")]
        [HasPermission("printtemplates.manage.update")]
        public async Task<IActionResult> Upsert(int companyId, string templateType, [FromBody] UpsertPrintTemplateDto dto)
        {
            var validTypes = new[] { "Challan", "Bill", "TaxInvoice" };
            if (!validTypes.Contains(templateType))
                return BadRequest(new { error = "Invalid template type. Use: Challan, Bill, or TaxInvoice" });

            var t = await _repo.UpsertAsync(companyId, templateType, dto.HtmlContent, dto.TemplateJson, dto.EditorMode);
            return Ok(ToDto(t));
        }

        // ───────── Excel Template Upload / Download / Delete ─────────

        [HttpPost("company/{companyId}/{templateType}/excel-template")]
        [HasPermission("printtemplates.manage.update")]
        public async Task<IActionResult> UploadExcelTemplate(int companyId, string templateType, IFormFile file)
        {
            var validTypes = new[] { "Challan", "Bill", "TaxInvoice" };
            if (!validTypes.Contains(templateType))
                return BadRequest(new { error = "Invalid template type" });

            if (file == null || file.Length == 0)
                return BadRequest(new { error = "No file uploaded" });

            if (file.Length > 10 * 1024 * 1024)
                return BadRequest(new { error = "File size must be under 10 MB" });

            var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
            var allowed = new[] { ".xlsx", ".xlsm" };
            if (!allowed.Contains(ext))
                return BadRequest(new { error = "Only .xlsx and .xlsm files are allowed. Please save .xls files as .xlsx first." });

            var targetDir = Path.Combine(Directory.GetCurrentDirectory(), "data", "uploads", "excel-templates");
            Directory.CreateDirectory(targetDir);

            var fileName = $"company_{companyId}_{templateType}{ext}";
            var filePath = Path.Combine(targetDir, fileName);

            // Delete any existing template files for this company/type
            foreach (var oldExt in new[] { ".xlsx", ".xlsm", ".xls" })
            {
                var oldPath = Path.Combine(targetDir, $"company_{companyId}_{templateType}{oldExt}");
                if (System.IO.File.Exists(oldPath)) System.IO.File.Delete(oldPath);
            }

            using (var stream = new FileStream(filePath, FileMode.Create))
            {
                await file.CopyToAsync(stream);
            }

            var relativePath = $"/data/uploads/excel-templates/{fileName}";

            // Update the PrintTemplate record (create if needed)
            var template = await _repo.GetByCompanyAndTypeAsync(companyId, templateType);
            if (template != null)
            {
                template.ExcelTemplatePath = relativePath;
                template.UpdatedAt = DateTime.UtcNow;
                await _repo.SaveAsync();
            }
            else
            {
                await _repo.UpsertExcelPathAsync(companyId, templateType, relativePath);
            }

            return Ok(new { excelTemplatePath = relativePath, hasExcelTemplate = true });
        }

        [HttpDelete("company/{companyId}/{templateType}/excel-template")]
        [HasPermission("printtemplates.manage.update")]
        public async Task<IActionResult> DeleteExcelTemplate(int companyId, string templateType)
        {
            var template = await _repo.GetByCompanyAndTypeAsync(companyId, templateType);
            if (template == null || string.IsNullOrEmpty(template.ExcelTemplatePath))
                return NotFound(new { error = "No Excel template found" });

            var filePath = Path.Combine(Directory.GetCurrentDirectory(), template.ExcelTemplatePath.TrimStart('/'));
            if (System.IO.File.Exists(filePath)) System.IO.File.Delete(filePath);

            template.ExcelTemplatePath = null;
            template.UpdatedAt = DateTime.UtcNow;
            await _repo.SaveAsync();

            return Ok(new { hasExcelTemplate = false });
        }

        [HttpGet("company/{companyId}/{templateType}/has-excel-template")]
        public async Task<IActionResult> HasExcelTemplate(int companyId, string templateType)
        {
            var template = await _repo.GetByCompanyAndTypeAsync(companyId, templateType);
            bool has = template != null && !string.IsNullOrEmpty(template.ExcelTemplatePath)
                && System.IO.File.Exists(Path.Combine(Directory.GetCurrentDirectory(), template.ExcelTemplatePath.TrimStart('/')));
            return Ok(new { hasExcelTemplate = has });
        }

        // ───────── Excel Export (fill template with data) ─────────

        [HttpPost("company/{companyId}/Challan/export-excel")]
        public async Task<IActionResult> ExportChallanExcel(int companyId, [FromBody] PrintChallanDto dto)
        {
            return await ProcessExcelExport(companyId, "Challan", ExcelTemplateEngine.ChallanToDict(dto),
                $"DC # {dto.ChallanNumber} {dto.ClientName}");
        }

        [HttpPost("company/{companyId}/Bill/export-excel")]
        public async Task<IActionResult> ExportBillExcel(int companyId, [FromBody] PrintBillDto dto)
        {
            return await ProcessExcelExport(companyId, "Bill", ExcelTemplateEngine.BillToDict(dto),
                $"Bill # {dto.InvoiceNumber} {dto.ClientName}");
        }

        [HttpPost("company/{companyId}/TaxInvoice/export-excel")]
        public async Task<IActionResult> ExportTaxInvoiceExcel(int companyId, [FromBody] PrintTaxInvoiceDto dto)
        {
            // Uppercase INVOICE prefix — matches operator convention for tax invoices
            // (distinguishes from the standard non-tax "Bill # ..." export filename).
            return await ProcessExcelExport(companyId, "TaxInvoice", ExcelTemplateEngine.TaxInvoiceToDict(dto),
                $"INVOICE # {dto.InvoiceNumber} {dto.BuyerName}");
        }

        private async Task<IActionResult> ProcessExcelExport(int companyId, string templateType,
            Dictionary<string, object?> data, string filename)
        {
            var template = await _repo.GetByCompanyAndTypeAsync(companyId, templateType);
            if (template == null || string.IsNullOrEmpty(template.ExcelTemplatePath))
                return NotFound(new { error = "No Excel template configured for this company and type" });

            var filePath = Path.Combine(Directory.GetCurrentDirectory(), template.ExcelTemplatePath.TrimStart('/'));
            if (!System.IO.File.Exists(filePath))
                return NotFound(new { error = "Excel template file not found on disk" });

            using var workbook = new XLWorkbook(filePath);
            ExcelTemplateEngine.Process(workbook, data);

            using var ms = new MemoryStream();
            workbook.SaveAs(ms);
            ms.Position = 0;

            return File(ms.ToArray(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                $"{filename}.xlsx");
        }
    }
}
