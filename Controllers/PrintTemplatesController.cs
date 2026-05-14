using ClosedXML.Excel;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Helpers.ExcelImport;
using MyApp.Api.Middleware;
using MyApp.Api.Repositories.Interfaces;

namespace MyApp.Api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    [AuthorizeCompany]
    public class PrintTemplatesController : ControllerBase
    {
        private readonly IPrintTemplateRepository _repo;
        public PrintTemplatesController(IPrintTemplateRepository repo) => _repo = repo;

        private static PrintTemplateDto ToDto(Models.PrintTemplate t)
        {
            bool hasFile = !string.IsNullOrEmpty(t.ExcelTemplatePath) && System.IO.File.Exists(
                Path.Combine(Directory.GetCurrentDirectory(), (t.ExcelTemplatePath ?? "").TrimStart('/')));
            List<string>? sheetNames = null;
            if (hasFile)
            {
                try
                {
                    var fullPath = Path.Combine(Directory.GetCurrentDirectory(), (t.ExcelTemplatePath ?? "").TrimStart('/'));
                    using var wb = new XLWorkbook(fullPath);
                    sheetNames = wb.Worksheets.Select(ws => ws.Name).ToList();
                }
                catch
                {
                    // Best-effort — if we can't open the file for any reason,
                    // the picker just falls back to a free-text input.
                    sheetNames = null;
                }
            }
            return new PrintTemplateDto
            {
                Id = t.Id,
                CompanyId = t.CompanyId,
                TemplateType = t.TemplateType,
                HtmlContent = t.HtmlContent,
                TemplateJson = t.TemplateJson,
                EditorMode = t.EditorMode,
                HasExcelTemplate = hasFile,
                ExcelSheetName = t.ExcelSheetName,
                ExcelSheetNames = sheetNames,
                UpdatedAt = t.UpdatedAt
            };
        }

        [HttpGet("company/{companyId}")]
        [HasPermission("printtemplates.manage.view")]
        public async Task<IActionResult> GetByCompany(int companyId)
        {
            // Audit M-6 (2026-05-13): templates contain operator-authored
            // HTML — gate behind the print-template view perm so general
            // tenant members don't pull script-containing template bodies.
            var templates = await _repo.GetByCompanyAsync(companyId);
            return Ok(templates.Select(ToDto));
        }

        [HttpGet("company/{companyId}/{templateType}")]
        [HasPermission("printtemplates.manage.view")]
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
        public async Task<IActionResult> UploadExcelTemplate(int companyId, string templateType, IFormFile file, [FromForm] string? sheetName = null)
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

            // Validate sheetName (if provided) against the actual workbook
            // so we don't store a name that doesn't exist in the file.
            string? validatedSheetName = null;
            List<string> availableSheets = new();
            try
            {
                using var wb = new XLWorkbook(filePath);
                availableSheets = wb.Worksheets.Select(ws => ws.Name).ToList();
                if (!string.IsNullOrWhiteSpace(sheetName))
                {
                    validatedSheetName = availableSheets.FirstOrDefault(s =>
                        string.Equals(s, sheetName, StringComparison.OrdinalIgnoreCase));
                }
            }
            catch
            {
                // Workbook unreadable here would have failed the reverse-mapper
                // path later too — leave validatedSheetName null and let the
                // importer's score-based fallback handle it.
            }

            // Update the PrintTemplate record (create if needed). UpsertExcelPathAsync
            // handles both branches and sets ExcelSheetName atomically.
            await _repo.UpsertExcelPathAsync(companyId, templateType, relativePath, validatedSheetName);

            return Ok(new
            {
                excelTemplatePath = relativePath,
                hasExcelTemplate = true,
                excelSheetName = validatedSheetName,
                excelSheetNames = availableSheets,
            });
        }

        // PUT — let the operator change the sheet pin without re-uploading the
        // template. Body: { "sheetName": "Delivery Note 1" } (or null to clear).
        // Gated by a dedicated perm (printtemplates.manage.sheetpin) so a role
        // can be allowed to fix the pin without also gaining rights to re-upload
        // or edit the template body.
        [HttpPut("company/{companyId}/{templateType}/excel-template/sheet-name")]
        [HasPermission("printtemplates.manage.sheetpin")]
        public async Task<IActionResult> SetExcelSheetName(int companyId, string templateType, [FromBody] SetSheetNameDto dto)
        {
            var template = await _repo.GetByCompanyAndTypeAsync(companyId, templateType);
            if (template == null || string.IsNullOrEmpty(template.ExcelTemplatePath))
                return NotFound(new { error = "No Excel template found for this company/type." });

            // Validate against the actual workbook's sheet list so we don't
            // store a name the file doesn't have. Empty/null clears the pin
            // and lets the importer's auto-detection take over.
            string? validated = null;
            if (!string.IsNullOrWhiteSpace(dto?.SheetName))
            {
                try
                {
                    var fullPath = Path.Combine(Directory.GetCurrentDirectory(), template.ExcelTemplatePath.TrimStart('/'));
                    using var wb = new XLWorkbook(fullPath);
                    validated = wb.Worksheets
                        .Select(ws => ws.Name)
                        .FirstOrDefault(n => string.Equals(n, dto.SheetName, StringComparison.OrdinalIgnoreCase));
                    if (validated == null)
                        return BadRequest(new { error = $"Sheet '{dto.SheetName}' not found in the uploaded template." });
                }
                catch
                {
                    return BadRequest(new { error = "Could not read the uploaded template." });
                }
            }
            template.ExcelSheetName = validated;
            template.UpdatedAt = DateTime.UtcNow;
            await _repo.SaveAsync();
            return Ok(new { excelSheetName = template.ExcelSheetName });
        }

        public class SetSheetNameDto
        {
            public string? SheetName { get; set; }
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

            // ClosedXML's formula parser throws `ClosedXML.Parser.ParsingException`
            // on malformed defined names / cell formulas inside the operator-uploaded
            // template (most common cause: a cell typed as "={{somefield}}" which
            // Excel tagged as a formula). Catch those at the boundary and surface
            // a friendly 400 instead of crashing the request with a stack trace
            // the operator can't act on. The engine's NeutralizePlaceholderFormulas
            // pass should already prevent this, but a final safety net is cheap.
            try
            {
                using var workbook = new XLWorkbook(filePath);
                ExcelTemplateEngine.Process(workbook, data);

                using var ms = new MemoryStream();
                workbook.SaveAs(ms);
                ms.Position = 0;

                return File(ms.ToArray(),
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    $"{filename}.xlsx");
            }
            catch (ClosedXML.Parser.ParsingException)
            {
                return BadRequest(new
                {
                    error = "Your Excel template has a malformed formula or named range. "
                          + "Common cause: a cell typed as \"={{field}}\" — change the cell "
                          + "to plain text \"{{field}}\" (no leading '='), then re-upload the "
                          + "template on the Print Templates page."
                });
            }
            catch (Exception ex) when (ex.GetType().FullName?.Contains("ClosedXML") == true)
            {
                return BadRequest(new
                {
                    error = "Couldn't fill the Excel template — the file may be corrupt or "
                          + "use features ClosedXML can't read. Try re-saving it from Excel "
                          + "and uploading again."
                });
            }
        }
    }
}
