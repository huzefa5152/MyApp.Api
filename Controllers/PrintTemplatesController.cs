using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using ClosedXML.Excel;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Helpers.ExcelImport;
using MyApp.Api.Middleware;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    // NOTE: [AuthorizeCompany] is applied PER-ACTION (not on the class) because the
    // id-based management endpoints ({id}) have no companyId route param — the class
    // filter would 400 them with "Missing required 'companyId'". Company-scoped actions
    // carry [AuthorizeCompany]; id-based actions load the row and assert access manually.
    public class PrintTemplatesController : ControllerBase
    {
        private static readonly string[] ValidTypes = PrintTemplateTypes.All;

        private readonly IPrintTemplateRepository _repo;
        private readonly ICompanyAccessGuard _access;
        private readonly IDivisionAccessGuard _divisionAccess;
        private readonly IDivisionService _divisions;
        private readonly IAuditLogService _audit;

        public PrintTemplatesController(IPrintTemplateRepository repo, ICompanyAccessGuard access,
            IDivisionAccessGuard divisionAccess, IDivisionService divisions, IAuditLogService audit)
        {
            _repo = repo;
            _access = access;
            _divisionAccess = divisionAccess;
            _divisions = divisions;
            _audit = audit;
        }

        // Fire-and-forget business-event audit. Never let an audit failure break
        // the operation (mirrors InvoiceService discipline). The template NAME is
        // included so the fingerprint (which normalises digits to '#') still
        // differentiates events on distinctly-named templates.
        private async Task AuditAsync(string eventType, string message, int companyId, int statusCode = 200)
        {
            try
            {
                await _audit.LogAsync(new AuditLog
                {
                    Timestamp = DateTime.UtcNow,
                    Level = "Information",
                    UserName = User.Identity?.Name,
                    HttpMethod = Request.Method,
                    RequestPath = Request.Path,
                    StatusCode = statusCode,
                    ExceptionType = eventType,
                    Message = message,
                    CompanyId = companyId,
                });
            }
            catch { /* audit must never break the operation */ }
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

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
                DivisionId = t.DivisionId,
                DivisionName = t.Division?.Name,
                TemplateType = t.TemplateType,
                Name = t.Name,
                IsDefault = t.IsDefault,
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
        [AuthorizeCompany]
        public async Task<IActionResult> GetByCompany(int companyId)
        {
            // Audit M-6 (2026-05-13): templates contain operator-authored
            // HTML — gate behind the print-template view perm so general
            // tenant members don't pull script-containing template bodies.
            var templates = await _repo.GetByCompanyAsync(companyId);
            // Division RBAC: restricted users see their divisions' templates
            // plus company-level ones (DivisionId == null) — policy D1.
            var divScope = await _divisionAccess.GetAccessibleDivisionIdsAsync(CurrentUserId, companyId);
            if (divScope != null)
                templates = templates.Where(t => t.DivisionId == null || divScope.Contains(t.DivisionId.Value)).ToList();
            return Ok(templates.Select(ToDto));
        }

        [HttpGet("company/{companyId}/{templateType}")]
        [HasPermission("printtemplates.manage.view")]
        [AuthorizeCompany]
        public async Task<IActionResult> GetByCompanyAndType(int companyId, string templateType)
        {
            // Resolves the company-level default for the type (print/editor entry point).
            var t = await _repo.GetByCompanyAndTypeAsync(companyId, templateType);
            if (t == null) return NotFound();
            return Ok(ToDto(t));
        }

        [HttpPut("company/{companyId}/{templateType}")]
        [HasPermission("printtemplates.manage.update")]
        [AuthorizeCompany]
        public async Task<IActionResult> Upsert(int companyId, string templateType, [FromBody] UpsertPrintTemplateDto dto)
        {
            if (!ValidTypes.Contains(templateType))
                return BadRequest(new { error = $"Invalid template type. Use one of: {PrintTemplateTypes.AllForDisplay}" });

            // Division RBAC: this writes the company-level default — restricted
            // users may not overwrite it (write-assert rejects null, policy D2).
            await _divisionAccess.AssertWriteAccessAsync(CurrentUserId, companyId, null);

            // Legacy single-template save path — upserts the company-level default.
            var t = await _repo.UpsertAsync(companyId, templateType, dto.HtmlContent, dto.TemplateJson, dto.EditorMode);
            return Ok(ToDto(t));
        }

        // ───────── Multi-template management (id-based) ─────────

        [HttpGet("{id:int}")]
        [HasPermission("printtemplates.manage.view")]
        public async Task<IActionResult> GetById(int id)
        {
            var t = await _repo.GetByIdAsync(id);
            if (t == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, t.CompanyId);
            await _divisionAccess.AssertAccessAsync(CurrentUserId, t.CompanyId, t.DivisionId);
            return Ok(ToDto(t));
        }

        [HttpPost("company/{companyId}")]
        [HasPermission("printtemplates.manage.update")]
        [AuthorizeCompany]
        public async Task<IActionResult> Create(int companyId, [FromBody] CreatePrintTemplateDto dto)
        {
            if (!ValidTypes.Contains(dto.TemplateType))
                return BadRequest(new { error = "Invalid template type." });

            // Cross-tenant link guard (CLAUDE.md §4): a division-scoped template's
            // division must belong to the same company we're creating under.
            if (dto.DivisionId.HasValue)
            {
                var div = await _divisions.GetByIdAsync(dto.DivisionId.Value);
                if (div == null || div.CompanyId != companyId)
                    return BadRequest(new { error = "Invalid division for this company." });
            }

            // Division-restricted users must tag the template with one of their
            // divisions (write-assert also rejects null — policy D2).
            await _divisionAccess.AssertWriteAccessAsync(CurrentUserId, companyId, dto.DivisionId);

            var name = string.IsNullOrWhiteSpace(dto.Name) ? "Untitled" : dto.Name.Trim();
            var t = await _repo.CreateAsync(companyId, dto.DivisionId, dto.TemplateType, name,
                dto.HtmlContent, dto.TemplateJson, dto.EditorMode, dto.IsDefault);
            await AuditAsync("PRINTTEMPLATE_CREATE",
                $"Created {dto.TemplateType} print template \"{name}\" (id {t.Id}) in company {companyId}", companyId);
            return Ok(ToDto(t));
        }

        [HttpPut("{id:int}")]
        [HasPermission("printtemplates.manage.update")]
        public async Task<IActionResult> Update(int id, [FromBody] UpdatePrintTemplateDto dto)
        {
            var existing = await _repo.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            await _divisionAccess.AssertAccessAsync(CurrentUserId, existing.CompanyId, existing.DivisionId);

            var updated = await _repo.UpdateContentAsync(id, dto.Name, dto.HtmlContent, dto.TemplateJson, dto.EditorMode);
            if (updated == null) return NotFound();
            await AuditAsync("PRINTTEMPLATE_UPDATE",
                $"Edited {updated.TemplateType} print template \"{updated.Name}\" (id {id}) in company {existing.CompanyId}", existing.CompanyId);
            return Ok(ToDto(updated));
        }

        // Apply a starter design onto an EXISTING template. "Replace HTML only"
        // swaps the body HTML while preserving the visual-editor layout/mode
        // (templateJson/editorMode) and all metadata; "Replace everything" also
        // replaces the layout (nulls templateJson, resets to code mode). Name,
        // scope, default flag, Excel attachment and id are always preserved.
        [HttpPost("{id:int}/apply-starter")]
        [HasPermission("printtemplates.starter.apply")]
        public async Task<IActionResult> ApplyStarter(int id, [FromBody] ApplyStarterDto dto)
        {
            var existing = await _repo.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            await _divisionAccess.AssertAccessAsync(CurrentUserId, existing.CompanyId, existing.DivisionId);
            if (string.IsNullOrWhiteSpace(dto?.HtmlContent))
                return BadRequest(new { error = "Starter HTML is required." });

            var replaceAll = string.Equals(dto.Mode, "all", StringComparison.OrdinalIgnoreCase);
            // Replace-HTML-only keeps the existing layout JSON + editor mode;
            // Replace-everything discards them so the starter's code IS the template.
            var json = replaceAll ? null : existing.TemplateJson;
            var mode = replaceAll ? "code" : existing.EditorMode;
            var updated = await _repo.UpdateContentAsync(id, existing.Name, dto.HtmlContent, json, mode);
            if (updated == null) return NotFound();

            var starter = string.IsNullOrWhiteSpace(dto.StarterName) ? "a starter" : $"\"{dto.StarterName}\"";
            await AuditAsync("PRINTTEMPLATE_APPLY_STARTER",
                $"Applied starter {starter} ({(replaceAll ? "replace everything" : "replace HTML only")}) onto "
                + $"{updated.TemplateType} template \"{updated.Name}\" (id {id}) in company {existing.CompanyId}",
                existing.CompanyId);
            return Ok(ToDto(updated));
        }

        public class ApplyStarterDto
        {
            public string HtmlContent { get; set; } = "";
            public string? Mode { get; set; }        // "html" (default) | "all"
            public string? StarterName { get; set; } // for the audit trail
        }

        [HttpPut("{id:int}/default")]
        [HasPermission("printtemplates.manage.update")]
        public async Task<IActionResult> SetDefault(int id)
        {
            var existing = await _repo.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            await _divisionAccess.AssertAccessAsync(CurrentUserId, existing.CompanyId, existing.DivisionId);

            await _repo.SetDefaultAsync(id);
            await AuditAsync("PRINTTEMPLATE_SET_DEFAULT",
                $"Set {existing.TemplateType} print template \"{existing.Name}\" (id {id}) as default in company {existing.CompanyId}", existing.CompanyId);
            return Ok(new { id, isDefault = true });
        }

        [HttpDelete("{id:int}")]
        [HasPermission("printtemplates.manage.delete")]
        public async Task<IActionResult> Delete(int id)
        {
            var existing = await _repo.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            await _divisionAccess.AssertAccessAsync(CurrentUserId, existing.CompanyId, existing.DivisionId);

            var excelPath = await _repo.DeleteAsync(id);
            if (!string.IsNullOrEmpty(excelPath))
            {
                var full = Path.Combine(Directory.GetCurrentDirectory(), excelPath.TrimStart('/'));
                if (System.IO.File.Exists(full)) System.IO.File.Delete(full);
            }
            await AuditAsync("PRINTTEMPLATE_DELETE",
                $"Deleted {existing.TemplateType} print template \"{existing.Name}\" (id {id}) from company {existing.CompanyId}", existing.CompanyId);
            return NoContent();
        }

        // ───────── Excel Template Upload / Download / Delete (id-based) ─────────

        [HttpPost("{id:int}/excel-template")]
        [HasPermission("printtemplates.manage.update")]
        public async Task<IActionResult> UploadExcelTemplateById(int id, IFormFile file, [FromForm] string? sheetName = null)
        {
            var template = await _repo.GetByIdAsync(id);
            if (template == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, template.CompanyId);
            await _divisionAccess.AssertAccessAsync(CurrentUserId, template.CompanyId, template.DivisionId);

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

            // Remove this template's previous file (whatever its stored path/ext), plus
            // any stale id-named files of either extension.
            if (!string.IsNullOrEmpty(template.ExcelTemplatePath))
            {
                var prev = Path.Combine(Directory.GetCurrentDirectory(), template.ExcelTemplatePath.TrimStart('/'));
                if (System.IO.File.Exists(prev)) System.IO.File.Delete(prev);
            }
            foreach (var oldExt in allowed)
            {
                var oldPath = Path.Combine(targetDir, $"template_{id}{oldExt}");
                if (System.IO.File.Exists(oldPath)) System.IO.File.Delete(oldPath);
            }

            // Filename keyed on the template id (multiple templates of one type now
            // exist, so the legacy company_{id}_{type} name would collide).
            var fileName = $"template_{id}{ext}";
            var filePath = Path.Combine(targetDir, fileName);
            using (var stream = new FileStream(filePath, FileMode.Create))
            {
                await file.CopyToAsync(stream);
            }

            var relativePath = $"/data/uploads/excel-templates/{fileName}";

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
                // Workbook unreadable here would have failed the reverse-mapper path
                // later too — leave the pin null and let auto-detection handle it.
            }

            template.ExcelTemplatePath = relativePath;
            template.ExcelSheetName = validatedSheetName;
            template.UpdatedAt = DateTime.UtcNow;
            await _repo.SaveAsync();

            await AuditAsync("PRINTTEMPLATE_EXCEL_UPLOAD",
                $"Uploaded Excel layout for {template.TemplateType} template \"{template.Name}\" (id {id}) in company {template.CompanyId}", template.CompanyId);

            return Ok(new
            {
                excelTemplatePath = relativePath,
                hasExcelTemplate = true,
                excelSheetName = validatedSheetName,
                excelSheetNames = availableSheets,
            });
        }

        [HttpPut("{id:int}/excel-template/sheet-name")]
        [HasPermission("printtemplates.manage.sheetpin")]
        public async Task<IActionResult> SetExcelSheetNameById(int id, [FromBody] SetSheetNameDto dto)
        {
            var template = await _repo.GetByIdAsync(id);
            if (template == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, template.CompanyId);
            await _divisionAccess.AssertAccessAsync(CurrentUserId, template.CompanyId, template.DivisionId);
            if (string.IsNullOrEmpty(template.ExcelTemplatePath))
                return NotFound(new { error = "No Excel template found for this template." });

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

        [HttpDelete("{id:int}/excel-template")]
        [HasPermission("printtemplates.manage.update")]
        public async Task<IActionResult> DeleteExcelTemplateById(int id)
        {
            var template = await _repo.GetByIdAsync(id);
            if (template == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, template.CompanyId);
            await _divisionAccess.AssertAccessAsync(CurrentUserId, template.CompanyId, template.DivisionId);
            if (string.IsNullOrEmpty(template.ExcelTemplatePath))
                return NotFound(new { error = "No Excel template found" });

            var filePath = Path.Combine(Directory.GetCurrentDirectory(), template.ExcelTemplatePath.TrimStart('/'));
            if (System.IO.File.Exists(filePath)) System.IO.File.Delete(filePath);

            template.ExcelTemplatePath = null;
            template.UpdatedAt = DateTime.UtcNow;
            await _repo.SaveAsync();

            await AuditAsync("PRINTTEMPLATE_EXCEL_DELETE",
                $"Removed Excel layout from {template.TemplateType} template \"{template.Name}\" (id {id}) in company {template.CompanyId}", template.CompanyId);

            return Ok(new { hasExcelTemplate = false });
        }

        [HttpGet("{id:int}/has-excel-template")]
        public async Task<IActionResult> HasExcelTemplateById(int id)
        {
            var template = await _repo.GetByIdAsync(id);
            if (template == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, template.CompanyId);
            await _divisionAccess.AssertAccessAsync(CurrentUserId, template.CompanyId, template.DivisionId);
            bool has = !string.IsNullOrEmpty(template.ExcelTemplatePath)
                && System.IO.File.Exists(Path.Combine(Directory.GetCurrentDirectory(), template.ExcelTemplatePath.TrimStart('/')));
            return Ok(new { hasExcelTemplate = has });
        }

        // ───────── Excel Template Upload / Download / Delete (legacy, company-default) ─────────

        [HttpPost("company/{companyId}/{templateType}/excel-template")]
        [HasPermission("printtemplates.manage.update")]
        [AuthorizeCompany]
        public async Task<IActionResult> UploadExcelTemplate(int companyId, string templateType, IFormFile file, [FromForm] string? sheetName = null)
        {
            if (!ValidTypes.Contains(templateType))
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
        [AuthorizeCompany]
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

        [HttpDelete("company/{companyId}/{templateType}/excel-template")]
        [HasPermission("printtemplates.manage.update")]
        [AuthorizeCompany]
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
        [AuthorizeCompany]
        public async Task<IActionResult> HasExcelTemplate(int companyId, string templateType)
        {
            var template = await _repo.GetByCompanyAndTypeAsync(companyId, templateType);
            bool has = template != null && !string.IsNullOrEmpty(template.ExcelTemplatePath)
                && System.IO.File.Exists(Path.Combine(Directory.GetCurrentDirectory(), template.ExcelTemplatePath.TrimStart('/')));
            return Ok(new { hasExcelTemplate = has });
        }

        // ───────── Excel Export (fill template with data) ─────────

        [HttpPost("company/{companyId}/Challan/export-excel")]
        [AuthorizeCompany]
        [HasPermission("challans.print.view")]
        public async Task<IActionResult> ExportChallanExcel(int companyId, [FromBody] PrintChallanDto dto)
        {
            return await ProcessExcelExport(companyId, dto.DivisionId, "Challan", ExcelTemplateEngine.ChallanToDict(dto),
                $"DC # {dto.ChallanNumber} {dto.ClientName}");
        }

        [HttpPost("company/{companyId}/Bill/export-excel")]
        [AuthorizeCompany]
        [HasPermission("bills.print.view")]
        public async Task<IActionResult> ExportBillExcel(int companyId, [FromBody] PrintBillDto dto)
        {
            return await ProcessExcelExport(companyId, dto.DivisionId, "Bill", ExcelTemplateEngine.BillToDict(dto),
                $"Bill # {dto.InvoiceNumber} {dto.ClientName}");
        }

        [HttpPost("company/{companyId}/TaxInvoice/export-excel")]
        [AuthorizeCompany]
        [HasPermission("invoices.print.view")]
        public async Task<IActionResult> ExportTaxInvoiceExcel(int companyId, [FromBody] PrintTaxInvoiceDto dto)
        {
            // Uppercase INVOICE prefix — matches operator convention for tax invoices
            // (distinguishes from the standard non-tax "Bill # ..." export filename).
            return await ProcessExcelExport(companyId, dto.DivisionId, "TaxInvoice", ExcelTemplateEngine.TaxInvoiceToDict(dto),
                $"INVOICE # {dto.InvoiceNumber} {dto.BuyerName}");
        }

        private async Task<IActionResult> ProcessExcelExport(int companyId, int? divisionId, string templateType,
            Dictionary<string, object?> data, string filename)
        {
            // Division-aware: prefer the document's division Excel layout, fall
            // back to the company-level one (GetForExportAsync). Both branches
            // only match rows that actually carry an Excel file.
            var template = await _repo.GetForExportAsync(companyId, divisionId, templateType);
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
