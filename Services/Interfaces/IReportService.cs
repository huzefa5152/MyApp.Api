using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    public interface IReportService
    {
        /// <summary>
        /// FBR Sales report for one company. Only invoices actually
        /// submitted to FBR are included, grouped by document date.
        /// </summary>
        /// <param name="companyId">Tenant company. Access is asserted by the caller.</param>
        /// <param name="year">Calendar year (e.g. 2026). Ignored when a custom range is supplied.</param>
        /// <param name="month">1–12 for a single month; null = full year.</param>
        /// <param name="buyerType">"unregistered" (walk-in) | "registered" | "all".</param>
        /// <param name="dateFrom">Custom range start (inclusive). When both dates are set, they override year/month.</param>
        /// <param name="dateTo">Custom range end (inclusive).</param>
        Task<SalesReportDto> GetSalesReportAsync(int companyId, int? year, int? month, string buyerType,
            DateTime? dateFrom = null, DateTime? dateTo = null);

        /// <summary>
        /// Same data as <see cref="GetSalesReportAsync"/>, rendered as a styled
        /// .xlsx workbook (grey title banner, bold headers, #,##0.00 money
        /// columns, per-day blocks with subtotals, grand total). Returns the
        /// raw file bytes for the controller to stream back.
        /// </summary>
        Task<byte[]> GetSalesReportExcelAsync(int companyId, int? year, int? month, string buyerType,
            DateTime? dateFrom = null, DateTime? dateTo = null);

        /// <summary>
        /// Tax Sheet: every invoice line whose item type still has no valid HS
        /// code, grouped per (invoice, item type), for the tax consultant to
        /// classify. Same period controls as <see cref="GetSalesReportAsync"/>.
        /// </summary>
        Task<TaxSheetReportDto> GetTaxSheetAsync(int companyId, int? year, int? month,
            DateTime? dateFrom = null, DateTime? dateTo = null);

        /// <summary>Styled .xlsx of <see cref="GetTaxSheetAsync"/>.</summary>
        Task<byte[]> GetTaxSheetExcelAsync(int companyId, int? year, int? month,
            DateTime? dateFrom = null, DateTime? dateTo = null);
    }
}
