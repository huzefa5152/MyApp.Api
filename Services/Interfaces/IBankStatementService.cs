using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// Bank statement import + categorization (the bank reconciliation design
    /// Phase 2). Imported lines live in a staging table with no GL impact until
    /// categorized (created as / matched to a receipt-payment). On import, lines
    /// are auto-matched to existing un-cleared payments and those get cleared.
    /// </summary>
    public interface IBankStatementService
    {
        Task<ImportStatementResultDto> ImportCsvAsync(int companyId, int bankAccountId, string fileName, string csvText);
        Task<List<BankStatementLineDto>> GetLinesAsync(int bankAccountId, string? status);
        Task<bool> CategorizeLineAsync(int lineId, CategorizeLineDto dto);
        Task<bool> IgnoreLineAsync(int lineId);
        /// <summary>Owning company of a line, for the tenant guard (null if missing).</summary>
        Task<int?> GetLineCompanyAsync(int lineId);
    }
}
