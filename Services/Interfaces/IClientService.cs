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
    }
}
