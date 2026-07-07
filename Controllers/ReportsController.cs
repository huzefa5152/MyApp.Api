using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
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

        public ReportsController(IReportService reports)
        {
            _reports = reports;
        }

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
            [FromQuery] DateTime? dateTo = null)
        {
            if (ValidatePeriod(year, month, dateFrom, dateTo) is { } err)
                return BadRequest(new { message = err });

            var report = await _reports.GetSalesReportAsync(companyId, year, month, buyerType, dateFrom, dateTo);
            return Ok(report);
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
            [FromQuery] DateTime? dateTo = null)
        {
            if (ValidatePeriod(year, month, dateFrom, dateTo) is { } err)
                return BadRequest(new { message = err });

            var bytes = await _reports.GetSalesReportExcelAsync(companyId, year, month, buyerType, dateFrom, dateTo);
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
            [FromQuery] DateTime? dateTo = null)
        {
            if (ValidatePeriod(year, month, dateFrom, dateTo) is { } err)
                return BadRequest(new { message = err });

            var report = await _reports.GetTaxSheetAsync(companyId, year, month, dateFrom, dateTo);
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
            [FromQuery] DateTime? dateTo = null)
        {
            if (ValidatePeriod(year, month, dateFrom, dateTo) is { } err)
                return BadRequest(new { message = err });

            var bytes = await _reports.GetTaxSheetExcelAsync(companyId, year, month, dateFrom, dateTo);
            var period = (dateFrom.HasValue && dateTo.HasValue)
                ? $"{dateFrom.Value:yyyy-MM-dd}_to_{dateTo.Value:yyyy-MM-dd}"
                : month.HasValue ? $"{year}-{month.Value:00}" : $"{year}";
            var fileName = $"Tax-Sheet-{period}.xlsx";
            return File(bytes,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                fileName);
        }
    }
}
