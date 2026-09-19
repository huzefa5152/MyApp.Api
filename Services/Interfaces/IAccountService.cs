using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>Chart of Accounts: the two-statement account tree, CRUD with
    /// tenant and control-account guards, and import-idempotent creates (upsert
    /// on ExternalRef).</summary>
    public interface IAccountService
    {
        Task<CoaTreeDto> GetTreeAsync(int companyId);
        Task<List<AccountDto>> GetAccountsFlatAsync(int companyId);

        /// <summary>Bank/cash accounts for the "Received in / Paid from" picker:
        /// accounts flagged <c>BankCash</c> OR asset accounts sitting in a group
        /// whose name mentions bank or cash. Active-only by default (pickers);
        /// pass <paramref name="includeInactive"/> for the management screen,
        /// which also populates <see cref="AccountDto.HasActivity"/>.</summary>
        Task<List<AccountDto>> GetBankCashAccountsAsync(int companyId, bool includeInactive = false);

        /// <summary>Correct a bank/cash account's opening balance (the setup
        /// "starting balance" seed) and move the equal-and-opposite delta onto
        /// Retained earnings so the opening balance sheet still balances. Returns
        /// the updated account, or null when not found.</summary>
        Task<AccountDto?> AdjustOpeningBalanceAsync(int id, AdjustOpeningBalanceDto dto);

        Task<AccountDto?> GetAccountByIdAsync(int id);
        Task<AccountGroupDto?> GetGroupByIdAsync(int id);

        Task<AccountGroupDto> CreateGroupAsync(int companyId, CreateAccountGroupDto dto);
        Task<AccountGroupDto?> UpdateGroupAsync(int id, UpdateAccountGroupDto dto);
        Task<bool> DeleteGroupAsync(int id);

        Task<AccountDto> CreateAccountAsync(int companyId, CreateAccountDto dto);
        Task<AccountDto?> UpdateAccountAsync(int id, UpdateAccountDto dto);
        Task<bool> DeleteAccountAsync(int id);
    }
}
