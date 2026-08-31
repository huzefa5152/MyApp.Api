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

        /// <summary>
        /// Client Ledger: every customer's money trail for the period, laid out
        /// the way the operator's own workbook does (see
        /// <see cref="ClientLedgerReportDto"/>). Composed entirely from
        /// <c>ICustomerLedgerService</c> — the ledger itself is never re-derived
        /// here; this only picks the window, chooses which customers to show and
        /// orders the service's entries for the page.
        /// </summary>
        /// <param name="clientId">Optional single-customer filter, resolved
        /// INSIDE the company and reported back as the customer GROUP it landed
        /// on. Null = every customer with activity or a carried-in balance; an
        /// explicit id always renders, even a dormant customer with nothing to
        /// show.</param>
        /// <exception cref="MyApp.Api.Helpers.ReportClientNotFoundException">A
        /// <paramref name="clientId"/> was supplied that does not exist in this
        /// company. A dedicated type so the controller's 404 path cannot also
        /// swallow unrelated <see cref="InvalidOperationException"/>s.</exception>
        Task<ClientLedgerReportDto> GetClientLedgerReportAsync(int companyId, int? year, int? month,
            int? clientId = null, DateTime? dateFrom = null, DateTime? dateTo = null);

        /// <summary>
        /// Styled .xlsx of <see cref="GetClientLedgerReportAsync"/> — a Summary
        /// sheet followed by one sheet per customer, each in the reference
        /// workbook's layout.
        /// </summary>
        Task<byte[]> GetClientLedgerReportExcelAsync(int companyId, int? year, int? month,
            int? clientId = null, DateTime? dateFrom = null, DateTime? dateTo = null);
    }
}
