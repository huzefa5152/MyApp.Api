using MyApp.Api.Models.Accounting;

namespace MyApp.Api.Repositories.Interfaces
{
    /// <summary>Data access for the Chart of Accounts. Reads are
    /// <c>AsNoTracking</c>; the by-id lookups are tracked because the service
    /// mutates what they return.</summary>
    public interface IAccountRepository
    {
        Task<List<AccountGroup>> GetGroupsAsync(int companyId);
        Task<List<Account>> GetAccountsAsync(int companyId);

        Task<AccountGroup?> GetGroupByIdAsync(int id);
        Task<Account?> GetAccountByIdAsync(int id);

        // ExternalRef lookups power idempotent seeds and imports (upsert on re-run).
        Task<AccountGroup?> GetGroupByExternalRefAsync(int companyId, string externalRef);
        Task<Account?> GetAccountByExternalRefAsync(int companyId, string externalRef);

        Task<bool> GroupHasChildrenAsync(int groupId);     // accounts OR sub-groups

        /// <summary>True when anything references the account. Such an account
        /// deactivates instead of deleting — the FKs would refuse the delete
        /// anyway, and a raw constraint violation is not an operator message.</summary>
        Task<bool> AccountHasActivityAsync(int accountId);

        /// <summary>Of the given candidate account ids, the subset that has any
        /// activity — the batched form of <see cref="AccountHasActivityAsync"/>
        /// for list screens that need a per-row "can delete?" hint without one
        /// query per row.</summary>
        Task<HashSet<int>> GetAccountIdsWithActivityAsync(IReadOnlyCollection<int> accountIds);

        Task<int> NextGroupPositionAsync(int companyId, FinancialStatement statement, int? parentGroupId);
        Task<int> NextAccountPositionAsync(int accountGroupId);

        Task<AccountGroup> AddGroupAsync(AccountGroup group);
        Task<Account> AddAccountAsync(Account account);
        Task SaveAsync();
        Task DeleteGroupAsync(AccountGroup group);
        Task DeleteAccountAsync(Account account);
    }
}
