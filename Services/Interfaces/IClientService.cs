using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    public interface IClientService
    {
        Task<IEnumerable<ClientDto>> GetAllAsync();
        Task<IEnumerable<ClientDto>> GetByCompanyAsync(int companyId);
        Task<ClientDto?> GetByIdAsync(int id);
        Task<ClientDto> CreateAsync(ClientDto dto);

        /// <summary>
        /// Creates the same client under multiple companies in one transaction.
        /// Each row is created via the standard CreateAsync path (so name-
        /// collision rules and EnsureGroup hooks fire identically), but if a
        /// company already has a client by this name we skip THAT one company
        /// and continue with the rest — the operator gets a structured "skipped
        /// because" list back instead of an all-or-nothing failure. Picking
        /// 2+ companies auto-creates a Common Client group for the new rows.
        /// </summary>
        Task<CreateClientBatchResultDto> CreateForCompaniesAsync(CreateClientBatchDto dto);

        /// <summary>
        /// Copy an existing client into one or more target companies. Reuses
        /// the multi-company create path under the hood, so the new rows are
        /// auto-linked to the source's Common Client group (via NTN /
        /// normalised-name match in EnsureGroup). The caller (controller) is
        /// responsible for asserting the user has access to the source's
        /// company AND every target company before invoking this.
        /// </summary>
        Task<CreateClientBatchResultDto> CopyToCompaniesAsync(int sourceClientId, List<int> targetCompanyIds);

        Task<ClientDto> UpdateAsync(ClientDto dto);
        Task DeleteAsync(int id);

        /// <summary>
        /// Per-client roll-up for the Customers screen (Manager.io-style
        /// columns): document counts + qty-to-deliver / qty-to-invoice +
        /// accounts receivable + withholding-tax receivable + status. Every
        /// client of the company is returned (incl. zero-activity ones), so
        /// the caller can render one row per client. Company-wide (clients are
        /// company-level entities, not division-scoped — matching the existing
        /// GetByCompanyAsync list).
        /// </summary>
        Task<List<ClientSummaryDto>> GetSummaryByCompanyAsync(int companyId);

        /// <summary>
        /// Drill-down bundle for one customer — their documents grouped by type
        /// (quotes, orders, invoices, credit notes, challans, WHT receipts),
        /// each capped most-recent-first with a full total. Powers the
        /// expandable customer-detail popup opened from the Customers table.
        /// </summary>
        Task<ClientDrilldownDto> GetDrilldownAsync(int clientId, string clientName);

        /// <summary>
        /// Customer A/R statement — chronological ledger of sale invoices
        /// (debits) and receipt allocations (credits) with a running balance,
        /// opened from the Accounts-Receivable cell.
        /// </summary>
        Task<ClientStatementDto> GetStatementAsync(int clientId, string clientName);
        /// <summary>Counts of what a client wipe will cascade-delete (+ FBR-submitted, which blocks it).</summary>
        Task<ClientDeleteImpactDto> GetDeleteImpactAsync(int id);
    }
}
