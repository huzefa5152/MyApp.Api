using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using MyApp.Api.Services.Implementations;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Reporting module. Read-only, company-scoped reports for the
    /// "Reports" navbar section. All endpoints require a per-report
    /// permission and assert tenant access via <see cref="AuthorizeCompanyAttribute"/>.
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/[controller]")]
    public class ReportsController : ControllerBase
    {
        private readonly IReportService _reports;

        private readonly AppDbContext _db;
        private readonly IWebHostEnvironment _env;
        private readonly TaxSheetImportService _taxSheetImport;
        private readonly IPermissionService _permissions;

        public ReportsController(IReportService reports, AppDbContext db, IWebHostEnvironment env,
            TaxSheetImportService taxSheetImport, IPermissionService permissions)
        {
            _reports = reports;
            _db = db;
            _env = env;
            _taxSheetImport = taxSheetImport;
            _permissions = permissions;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        private const long TaxSheetUploadMax = 10 * 1024 * 1024;

        // The company's letterhead and its Bill template's header colours for an
        // Excel export, when the screen asks for it (letterhead=true). Any other
        // caller keeps the workbook layout it always had. Presentation only;
        // [AuthorizeCompany] has already asserted access to companyId.
        private Task<ReportExcelLetterhead?> LetterheadAsync(bool wanted, int companyId, string? brandFill, string? brandText) =>
            wanted
                ? ReportExcelLetterhead.LoadAsync(_db, _env.ContentRootPath, companyId, brandFill, brandText)
                : Task.FromResult<ReportExcelLetterhead?>(null);

        /// <summary>
        /// Sales report for a company: FBR-submitted sale invoices grouped by
        /// document date, with daily subtotals and a grand total. Quantities
        /// reflect what was FILED to FBR (the dual-book overlay).
        /// </summary>
        /// <param name="companyId">Tenant company (access asserted by filter).</param>
        /// <param name="year">Calendar year, e.g. 2026.</param>
        /// <param name="month">1–12 for a single month; omit for the full year.</param>
        /// <param name="buyerType">"unregistered" (walk-in, default) | "registered" | "all".</param>
        [HttpGet("company/{companyId}/sales")]
        [HasPermission("reports.sales.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<SalesReportDto>> GetSalesReport(
            int companyId,
            [FromQuery] int? year = null,
            [FromQuery] int? month = null,
            [FromQuery] string buyerType = "all",
            [FromQuery] DateTime? dateFrom = null,
            [FromQuery] DateTime? dateTo = null,
            [FromQuery] int? clientId = null)
        {
            if (ValidatePeriod(year, month, dateFrom, dateTo) is { } err)
                return BadRequest(new { message = err });

            var report = await _reports.GetSalesReportAsync(companyId, year, month, buyerType, dateFrom, dateTo, clientId);
            return Ok(report);
        }

        [HttpGet("company/{companyId}/invoice-sales-detail")]
        [HasPermission("reports.invoicedetail.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<InvoiceSalesDetailReportDto>> GetInvoiceSalesDetail(
            int companyId, [FromQuery] InvoiceSalesDetailQueryDto query)
        {
            if (InvoiceSalesDetailFilter.Validate(query) is { } err)
                return BadRequest(new { message = err });
            return Ok(await _reports.GetInvoiceSalesDetailAsync(companyId, query));
        }

        [HttpGet("company/{companyId}/invoice-sales-detail/excel")]
        [HasPermission("reports.invoicedetail.export")]
        [AuthorizeCompany]
        public async Task<IActionResult> GetInvoiceSalesDetailExcel(
            int companyId, [FromQuery] InvoiceSalesDetailQueryDto query)
        {
            if (InvoiceSalesDetailFilter.Validate(query) is { } err)
                return BadRequest(new { message = err });
            var bytes = await _reports.GetInvoiceSalesDetailExcelAsync(companyId, query);
            var window = InvoiceSalesDetailFilter.ResolveWindow(query);
            return File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                InvoiceSalesDetailFilter.ExcelFileName(window.From!.Value, window.To!.Value));
        }

        // Shared period validation for both the JSON and Excel endpoints.
        // Returns an error message, or null when the period is valid.
        private static string? ValidatePeriod(int? year, int? month, DateTime? dateFrom, DateTime? dateTo)
        {
            var customRange = dateFrom.HasValue || dateTo.HasValue;
            if (customRange)
            {
                if (!dateFrom.HasValue || !dateTo.HasValue)
                    return "Provide both a start and end date for a custom range.";
                if (dateFrom.Value.Date > dateTo.Value.Date)
                    return "Start date must be on or before the end date.";
                return null;
            }
            if (!year.HasValue || year < 2000 || year > 2100)
                return "Provide a valid year, or a custom date range.";
            if (month.HasValue && (month.Value < 1 || month.Value > 12))
                return "Month must be between 1 and 12.";
            return null;
        }

        /// <summary>
        /// Same report as <see cref="GetSalesReport"/>, as a styled .xlsx
        /// download. Gated by the export permission.
        /// </summary>
        [HttpGet("company/{companyId}/sales/excel")]
        [HasPermission("reports.sales.export")]
        [AuthorizeCompany]
        public async Task<IActionResult> GetSalesReportExcel(
            int companyId,
            [FromQuery] int? year = null,
            [FromQuery] int? month = null,
            [FromQuery] string buyerType = "all",
            [FromQuery] DateTime? dateFrom = null,
            [FromQuery] DateTime? dateTo = null,
            [FromQuery] int? clientId = null,
            [FromQuery] string? brandFill = null,
            [FromQuery] string? brandText = null,
            [FromQuery] bool letterhead = false)
        {
            if (ValidatePeriod(year, month, dateFrom, dateTo) is { } err)
                return BadRequest(new { message = err });

            var bytes = await _reports.GetSalesReportExcelAsync(companyId, year, month, buyerType, dateFrom, dateTo, clientId,
                await LetterheadAsync(letterhead, companyId, brandFill, brandText));
            var period = (dateFrom.HasValue && dateTo.HasValue)
                ? $"{dateFrom.Value:yyyy-MM-dd}_to_{dateTo.Value:yyyy-MM-dd}"
                : month.HasValue ? $"{year}-{month.Value:00}" : $"{year}";
            var fileName = $"Sale-Report-{period}.xlsx";
            return File(bytes,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                fileName);
        }

        /// <summary>
        /// Tax Sheet: invoice lines still missing a valid HS code, for the tax
        /// consultant to classify. Same period controls as the Sales report.
        /// </summary>
        [HttpGet("company/{companyId}/tax-sheet")]
        [HasPermission("reports.taxsheet.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<TaxSheetReportDto>> GetTaxSheet(
            int companyId,
            [FromQuery] int? year = null,
            [FromQuery] int? month = null,
            [FromQuery] DateTime? dateFrom = null,
            [FromQuery] DateTime? dateTo = null,
            [FromQuery] int? clientId = null)
        {
            if (ValidatePeriod(year, month, dateFrom, dateTo) is { } err)
                return BadRequest(new { message = err });

            var report = await _reports.GetTaxSheetAsync(companyId, year, month, dateFrom, dateTo, clientId);
            return Ok(report);
        }

        /// <summary>Styled .xlsx of the Tax Sheet. Gated by the export permission.</summary>
        [HttpGet("company/{companyId}/tax-sheet/excel")]
        [HasPermission("reports.taxsheet.export")]
        [AuthorizeCompany]
        public async Task<IActionResult> GetTaxSheetExcel(
            int companyId,
            [FromQuery] int? year = null,
            [FromQuery] int? month = null,
            [FromQuery] DateTime? dateFrom = null,
            [FromQuery] DateTime? dateTo = null,
            [FromQuery] int? clientId = null,
            [FromQuery] string? brandFill = null,
            [FromQuery] string? brandText = null,
            [FromQuery] bool letterhead = false)
        {
            if (ValidatePeriod(year, month, dateFrom, dateTo) is { } err)
                return BadRequest(new { message = err });

            var bytes = await _reports.GetTaxSheetExcelAsync(companyId, year, month, dateFrom, dateTo, clientId,
                await LetterheadAsync(letterhead, companyId, brandFill, brandText));
            var period = (dateFrom.HasValue && dateTo.HasValue)
                ? $"{dateFrom.Value:yyyy-MM-dd}_to_{dateTo.Value:yyyy-MM-dd}"
                : month.HasValue ? $"{year}-{month.Value:00}" : $"{year}";
            var fileName = $"Tax-Sheet-{period}.xlsx";
            return File(bytes,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                fileName);
        }

        /// <summary>
        /// Bulk adjust: read a filled-in Tax Sheet workbook and report what would
        /// change (nothing is saved). Each invoice goes through the same rules as
        /// the Adjust screen, so the caller also needs a filing permission.
        /// </summary>
        [HttpPost("company/{companyId}/tax-sheet/import/preview")]
        [HasPermission("reports.taxsheet.import")]
        [AuthorizeCompany]
        [RequestSizeLimit(TaxSheetUploadMax + 64 * 1024)]
        [EnableRateLimiting("import")]
        public async Task<IActionResult> PreviewTaxSheetImport(int companyId, [FromForm] IFormFile? file)
        {
            if (await CheckTaxSheetUploadAsync(file) is { } bad) return bad;
            var canQty = await _permissions.HasPermissionAsync(CurrentUserId, "invoices.manage.update.itemtype.qty");
            await using var stream = file!.OpenReadStream();
            return Ok(await _taxSheetImport.PreviewAsync(companyId, stream, canQty));
        }

        /// <summary>Apply the filled-in Tax Sheet. The file is read again; nothing the browser kept is trusted.</summary>
        [HttpPost("company/{companyId}/tax-sheet/import/commit")]
        [HasPermission("reports.taxsheet.import")]
        [AuthorizeCompany]
        [RequestSizeLimit(TaxSheetUploadMax + 64 * 1024)]
        [EnableRateLimiting("import")]
        public async Task<IActionResult> CommitTaxSheetImport(int companyId, [FromForm] IFormFile? file)
        {
            if (await CheckTaxSheetUploadAsync(file) is { } bad) return bad;
            var canQty = await _permissions.HasPermissionAsync(CurrentUserId, "invoices.manage.update.itemtype.qty");
            await using var stream = file!.OpenReadStream();
            return Ok(await _taxSheetImport.CommitAsync(companyId, stream, CurrentUserId, User.Identity?.Name ?? "", canQty));
        }

        private async Task<IActionResult?> CheckTaxSheetUploadAsync(IFormFile? file)
        {
            // Same gate as saving filing rows by hand: the upload is only a faster way in.
            if (!await _permissions.HasPermissionAsync(CurrentUserId, "invoices.manage.update.itemtype")
                && !await _permissions.HasPermissionAsync(CurrentUserId, "invoices.manage.update.itemtype.qty"))
                return StatusCode(403, new { message = "You need permission to classify invoices to upload a tax sheet." });
            if (file == null || file.Length == 0) return BadRequest(new { message = "No file uploaded." });
            if (file.Length > TaxSheetUploadMax) return BadRequest(new { message = "The file is larger than 10 MB." });
            if (!string.Equals(Path.GetExtension(file.FileName ?? ""), ".xlsx", StringComparison.OrdinalIgnoreCase))
                return BadRequest(new { message = "Only .xlsx files are supported." });
            return null;
        }

        /// <summary>
        /// Move the still-unclassified invoices of a tax-sheet period onto a new
        /// date (typically the 1st of next month), so the consultant can defer
        /// what they didn't get to classify this period in one action instead of
        /// re-dating each bill by hand. Mutates invoice dates → gated by a
        /// dedicated write permission; submitted/cancelled invoices are skipped.
        /// </summary>
        [HttpPost("company/{companyId}/tax-sheet/transfer")]
        [HasPermission("reports.taxsheet.transfer")]
        [AuthorizeCompany]
        public async Task<ActionResult<TaxSheetTransferResultDto>> TransferTaxSheet(
            int companyId, [FromBody] TaxSheetTransferRequestDto dto)
        {
            if (dto == null) return BadRequest(new { message = "Request body is required." });
            if (dto.TargetDate == default) return BadRequest(new { message = "A target date is required." });
            if (ValidatePeriod(dto.Year, dto.Month, dto.DateFrom, dto.DateTo) is { } err)
                return BadRequest(new { message = err });

            var result = await _reports.TransferTaxSheetInvoicesAsync(
                companyId, dto.Year, dto.Month, dto.DateFrom, dto.DateTo,
                dto.ClientId, dto.TargetDate, User.Identity?.Name);
            return Ok(result);
        }

        /// <summary>
        /// Outstanding Ledger: per-client receivables (amount / paid / balance /
        /// payment status + the receipts that settled each bill).
        /// <paramref name="status"/> = "all" | "unpaid" (default) | "paid".
        /// </summary>
        [HttpGet("company/{companyId}/outstanding")]
        [HasPermission("reports.outstanding.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<OutstandingLedgerDto>> GetOutstandingLedger(
            int companyId, [FromQuery] int? clientId = null, [FromQuery] string status = "unpaid",
            [FromQuery] int? year = null, [FromQuery] int? month = null,
            [FromQuery] DateTime? dateFrom = null, [FromQuery] DateTime? dateTo = null)
        {
            if (ValidatePeriod(year, month, dateFrom, dateTo) is { } err)
                return BadRequest(new { message = err });
            var report = await _reports.GetOutstandingLedgerAsync(companyId, clientId, status, year, month, dateFrom, dateTo);
            return Ok(report);
        }

        /// <summary>Styled .xlsx of the Outstanding Ledger. Gated by the export permission.</summary>
        [HttpGet("company/{companyId}/outstanding/excel")]
        [HasPermission("reports.outstanding.export")]
        [AuthorizeCompany]
        public async Task<IActionResult> GetOutstandingLedgerExcel(
            int companyId, [FromQuery] int? clientId = null, [FromQuery] string status = "unpaid",
            [FromQuery] int? year = null, [FromQuery] int? month = null,
            [FromQuery] DateTime? dateFrom = null, [FromQuery] DateTime? dateTo = null,
            [FromQuery] string? brandFill = null, [FromQuery] string? brandText = null,
            [FromQuery] bool letterhead = false)
        {
            if (ValidatePeriod(year, month, dateFrom, dateTo) is { } err)
                return BadRequest(new { message = err });
            var bytes = await _reports.GetOutstandingLedgerExcelAsync(companyId, clientId, status, year, month, dateFrom, dateTo,
                await LetterheadAsync(letterhead, companyId, brandFill, brandText));
            var safeStatus = (status ?? "unpaid").Trim().ToLowerInvariant();
            var fileName = $"Outstanding-Ledger-{safeStatus}.xlsx";
            return File(bytes,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                fileName);
        }
    }
}
