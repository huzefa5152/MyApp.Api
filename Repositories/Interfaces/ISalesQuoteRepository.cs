using MyApp.Api.Models;

namespace MyApp.Api.Repositories.Interfaces
{
    public interface ISalesQuoteRepository
    {
        Task<List<SalesQuote>> GetByCompanyAsync(int companyId);
        Task<(List<SalesQuote> Items, int TotalCount)> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize,
            string? search = null, string? status = null,
            int? clientId = null, DateTime? dateFrom = null, DateTime? dateTo = null,
            int? divisionId = null);
        Task<SalesQuote?> GetByIdAsync(int id);
        Task<SalesQuote> UpdateAsync(SalesQuote quote);
        Task DeleteAsync(SalesQuote quote);
        Task<int> GetCountByCompanyAsync(int companyId);
        Task<int> GetMaxNumberAsync(int companyId);
        /// <summary>Highest QuoteNumber within a single numbering scope —
        /// a division (divisionId set) or the company-level scope (null).</summary>
        Task<int> GetMaxNumberAsync(int companyId, int? divisionId);
        /// <summary>Highest QuoteNumber per scope (DivisionId → max) for a
        /// company, so list views can flag IsLatest per division in one query.</summary>
        Task<Dictionary<int?, int>> GetMaxNumbersByScopeAsync(int companyId);
    }
}
