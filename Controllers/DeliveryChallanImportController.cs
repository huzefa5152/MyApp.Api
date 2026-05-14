using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers.ExcelImport;
using MyApp.Api.Middleware;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Bulk import of historical delivery challans from old Excel files.
    /// Two endpoints:
    ///   1. POST .../import-excel/preview   — parse files, return rows for review (no DB writes)
    ///   2. POST .../import-excel/commit    — accept the (possibly user-edited) rows and insert
    /// </summary>
    [ApiController]
    [Route("api/DeliveryChallans")]
    [Authorize]
    [HasPermission("challans.import.create")]
    public class DeliveryChallanImportController : LoggedControllerBase
    {
        private const int MaxFileBytes = 10 * 1024 * 1024;   // 10 MB per file
        private const int MaxFilesPerRequest = 50;            // keep a single preview bounded

        private readonly IPrintTemplateRepository _templateRepo;
        private readonly IExcelTemplateReverseMapper _reverseMapper;
        private readonly IChallanExcelImporter _importer;
        private readonly IDeliveryChallanService _challanService;
        private readonly IDeliveryChallanRepository _challanRepo;
        private readonly new ILogger<DeliveryChallanImportController> _logger;

        public DeliveryChallanImportController(
            IPrintTemplateRepository templateRepo,
            IExcelTemplateReverseMapper reverseMapper,
            IChallanExcelImporter importer,
            IDeliveryChallanService challanService,
            IDeliveryChallanRepository challanRepo,
            ILogger<DeliveryChallanImportController> logger) : base(logger)
        {
            _templateRepo = templateRepo;
            _reverseMapper = reverseMapper;
            _importer = importer;
            _challanService = challanService;
            _challanRepo = challanRepo;
            _logger = logger;
        }

        [HttpPost("company/{companyId}/import-excel/preview")]
        [RequestSizeLimit(MaxFilesPerRequest * MaxFileBytes)]
        [AuthorizeCompany]
        [EnableRateLimiting("import")]
        public async Task<IActionResult> Preview(int companyId, [FromForm] List<IFormFile> files, [FromForm] string? sheetName = null)
        {
            if (files == null || files.Count == 0)
                return BadRequest(new { error = "No files uploaded." });

            if (files.Count > MaxFilesPerRequest)
                return BadRequest(new { error = $"Too many files. Maximum {MaxFilesPerRequest} per request." });

            // Resolve the company's Challan template — its placeholders tell us
            // where each field lives, which we read back from the uploaded files.
            var template = await _templateRepo.GetByCompanyAndTypeAsync(companyId, "Challan");
            if (template == null || string.IsNullOrEmpty(template.ExcelTemplatePath))
                return NotFound(new { error = "No Challan Excel template is configured for this company. Upload one in Print Templates first." });

            var templatePath = Path.Combine(Directory.GetCurrentDirectory(), template.ExcelTemplatePath.TrimStart('/'));
            if (!System.IO.File.Exists(templatePath))
                return NotFound(new { error = "Challan template file is missing on disk." });

            TemplateCellMap cellMap;
            try
            {
                cellMap = _reverseMapper.Build(templatePath);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Challan import: template parse failed for company {CompanyId} ({Path})", companyId, templatePath);
                return BadRequest(new { error = "Could not read the challan template. Please re-upload it on the Print Templates page." });
            }

            // Sheet-name override resolution (highest priority first):
            //   1. Per-request `sheetName` form field — lets the operator
            //      pick a sheet just for this import batch without touching
            //      the template's persistent pin. Useful when one batch of
            //      legacy files lives on a different sheet than the rest.
            //   2. Template's persistent ExcelSheetName pin — set on the
            //      Print Templates page, applies to every import.
            //   3. Template's auto-detected sheet (already populated by the
            //      reverse mapper into cellMap.SheetName).
            // After this, ChallanExcelImporter.ResolveSheetIndex still
            // falls back to score-based detection if the resolved name
            // isn't present in the uploaded file.
            if (!string.IsNullOrWhiteSpace(sheetName))
            {
                cellMap.SheetName = sheetName;
            }
            else if (!string.IsNullOrWhiteSpace(template.ExcelSheetName))
            {
                cellMap.SheetName = template.ExcelSheetName;
            }

            var previews = new List<ChallanImportPreviewDto>();
            foreach (var file in files)
            {
                if (file.Length == 0)
                {
                    previews.Add(new ChallanImportPreviewDto
                    {
                        FileName = file.FileName,
                        Warnings = { "File is empty." }
                    });
                    continue;
                }
                if (file.Length > MaxFileBytes)
                {
                    previews.Add(new ChallanImportPreviewDto
                    {
                        FileName = file.FileName,
                        Warnings = { "File exceeds 10 MB limit." }
                    });
                    continue;
                }
                var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
                if (!WorkbookReaderFactory.IsSupported(ext))
                {
                    previews.Add(new ChallanImportPreviewDto
                    {
                        FileName = file.FileName,
                        Warnings = { $"Unsupported file type '{ext}'. Only .xls, .xlsx, .xlsm allowed." }
                    });
                    continue;
                }

                try
                {
                    var preview = await _importer.ExtractPreviewAsync(file, cellMap, companyId);
                    previews.Add(preview);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Challan import: per-file parse failed for {FileName} (company {CompanyId})", file.FileName, companyId);
                    previews.Add(new ChallanImportPreviewDto
                    {
                        FileName = file.FileName,
                        Warnings = { "Could not parse this file. Please verify it matches the configured Challan Excel template and try again." }
                    });
                }
            }

            // Flag duplicates in one DB round-trip so the operator sees "this
            // challan is already imported" before they click Confirm Import.
            // Commit-time validation is still the authoritative gate; this is
            // purely an early warning.
            var candidateNumbers = previews
                .Where(p => p.ChallanNumber > 0)
                .Select(p => p.ChallanNumber);
            var existing = await _challanRepo.GetExistingChallanNumbersAsync(companyId, candidateNumbers);
            foreach (var p in previews)
            {
                if (p.ChallanNumber > 0 && existing.Contains(p.ChallanNumber))
                {
                    p.AlreadyExists = true;
                    p.Warnings.Add($"Challan #{p.ChallanNumber} is already in the system for this company.");
                }
            }
            return Ok(previews);
        }

        [HttpPost("company/{companyId}/import-excel/commit")]
        [AuthorizeCompany]
        [EnableRateLimiting("import")]
        public async Task<IActionResult> Commit(int companyId, [FromBody] List<ChallanImportPreviewDto> rows)
        {
            if (rows == null || rows.Count == 0)
                return BadRequest(new { error = "No rows to commit." });

            var results = new List<ChallanImportResultDto>();
            foreach (var row in rows)
            {
                try
                {
                    var r = await _challanService.ImportHistoricalAsync(companyId, row);
                    results.Add(r);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Challan import: commit row #{ChallanNumber} ({FileName}) failed", row.ChallanNumber, row.FileName);
                    results.Add(new ChallanImportResultDto
                    {
                        FileName = row.FileName,
                        ChallanNumber = row.ChallanNumber,
                        Success = false,
                        // Operator-facing string only; the full exception is in
                        // the Serilog file sink + AuditLog.
                        Error = "Could not import this row. Check the matching delivery challan and try again."
                    });
                }
            }
            return Ok(results);
        }
    }
}
