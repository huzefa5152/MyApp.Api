using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>Chart of Accounts (design §4/§7): the two-statement account tree,
    /// CRUD with tenant + control-account guards, and import-idempotent creates
    /// (upsert on ExternalRef).</summary>
    public interface IAccountService
    {
        Task<CoaTreeDto> GetTreeAsync(int companyId);
        Task<List<AccountDto>> GetAccountsFlatAsync(int companyId);

        /// <summary>Active bank/cash accounts for the "Received in / Paid from"
        /// picker (manager.io-style): accounts flagged BankCash OR asset accounts
        /// under a Bank/Cash group (covers migrated bank GL accounts).</summary>
        Task<List<AccountDto>> GetBankCashAccountsAsync(int companyId);

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
