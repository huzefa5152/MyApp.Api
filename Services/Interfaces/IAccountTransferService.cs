using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>Inter-account transfers — money moved between two of the
    /// company's own bank/cash accounts (bank→cash drawer, bank→bank). No
    /// contact involved; the GL posting is Dr receiving / Cr paying account
    /// via <c>IPostingService.PostTransferAsync</c>.</summary>
    public interface IAccountTransferService
    {
        Task<PagedResult<AccountTransferDto>> GetPagedAsync(
            int companyId, int page, int pageSize,
            string? search = null,
            DateTime? dateFrom = null, DateTime? dateTo = null);

        Task<AccountTransferDto?> GetByIdAsync(int id);

        /// <summary>Create a transfer, allocate its per-company Number, and post
        /// its journal entry — all in one transaction. Throws
        /// InvalidOperationException on validation failures (non-positive amount,
        /// same account both sides, cross-tenant/non-bank-cash account, locked
        /// period).</summary>
        Task<AccountTransferDto> CreateAsync(int companyId, CreateAccountTransferDto dto);

        /// <summary>Full edit keeping the Number; re-validates and re-posts (the
        /// posting engine replaces the entry). Returns null if not found.</summary>
        Task<AccountTransferDto?> UpdateAsync(int id, CreateAccountTransferDto dto);

        /// <summary>Delete a transfer and its journal entry. Returns false if
        /// not found.</summary>
        Task<bool> DeleteAsync(int id);
    }
}
