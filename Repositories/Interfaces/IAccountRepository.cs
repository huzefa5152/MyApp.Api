using MyApp.Api.Models.Accounting;

namespace MyApp.Api.Repositories.Interfaces
{
    public interface IAccountRepository
    {
        Task<List<AccountGroup>> GetGroupsAsync(int companyId);
        Task<List<Account>> GetAccountsAsync(int companyId);

        Task<AccountGroup?> GetGroupByIdAsync(int id);
        Task<Account?> GetAccountByIdAsync(int id);

        // ExternalRef lookups power idempotent imports (upsert on re-run).
        Task<AccountGroup?> GetGroupByExternalRefAsync(int companyId, string externalRef);
        Task<Account?> GetAccountByExternalRefAsync(int companyId, string externalRef);

        Task<bool> GroupHasChildrenAsync(int groupId);     // accounts OR sub-groups

        /// <summary>True when anything references the account: journal lines,
        /// payment allocations, payment bank-account links, or transfers.
        /// Such accounts deactivate instead of deleting.</summary>
        Task<bool> AccountHasActivityAsync(int accountId);
        Task<int> NextGroupPositionAsync(int companyId, FinancialStatement statement, int? parentGroupId);
        Task<int> NextAccountPositionAsync(int accountGroupId);

        Task<AccountGroup> AddGroupAsync(AccountGroup group);
        Task<Account> AddAccountAsync(Account account);
        Task SaveAsync();
        Task DeleteGroupAsync(AccountGroup group);
        Task DeleteAccountAsync(Account account);
    }
}
