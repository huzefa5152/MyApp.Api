using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models.Accounting;
using MyApp.Api.Repositories.Interfaces;

namespace MyApp.Api.Repositories.Implementations
{
    public class AccountRepository : IAccountRepository
    {
        private readonly AppDbContext _context;

        public AccountRepository(AppDbContext context)
        {
            _context = context;
        }

        public async Task<List<AccountGroup>> GetGroupsAsync(int companyId) =>
            await _context.AccountGroups
                .Where(g => g.CompanyId == companyId)
                .OrderBy(g => g.Position).ThenBy(g => g.Id)
                .AsNoTracking().ToListAsync();

        public async Task<List<Account>> GetAccountsAsync(int companyId) =>
            await _context.Accounts
                .Where(a => a.CompanyId == companyId)
                .OrderBy(a => a.Position).ThenBy(a => a.Id)
                .AsNoTracking().ToListAsync();

        public async Task<AccountGroup?> GetGroupByIdAsync(int id) =>
            await _context.AccountGroups.FirstOrDefaultAsync(g => g.Id == id);

        public async Task<Account?> GetAccountByIdAsync(int id) =>
            await _context.Accounts.FirstOrDefaultAsync(a => a.Id == id);

        public async Task<AccountGroup?> GetGroupByExternalRefAsync(int companyId, string externalRef) =>
            await _context.AccountGroups.FirstOrDefaultAsync(g => g.CompanyId == companyId && g.ExternalRef == externalRef);

        public async Task<Account?> GetAccountByExternalRefAsync(int companyId, string externalRef) =>
            await _context.Accounts.FirstOrDefaultAsync(a => a.CompanyId == companyId && a.ExternalRef == externalRef);

        public async Task<bool> GroupHasChildrenAsync(int groupId) =>
            await _context.Accounts.AnyAsync(a => a.AccountGroupId == groupId)
            || await _context.AccountGroups.AnyAsync(g => g.ParentGroupId == groupId);

        public async Task<int> NextGroupPositionAsync(int companyId, FinancialStatement statement, int? parentGroupId)
        {
            var q = _context.AccountGroups.Where(g => g.CompanyId == companyId && g.Statement == statement);
            q = parentGroupId.HasValue ? q.Where(g => g.ParentGroupId == parentGroupId.Value) : q.Where(g => g.ParentGroupId == null);
            return (await q.MaxAsync(g => (int?)g.Position) ?? -1) + 1;
        }

        public async Task<int> NextAccountPositionAsync(int accountGroupId) =>
            (await _context.Accounts.Where(a => a.AccountGroupId == accountGroupId).MaxAsync(a => (int?)a.Position) ?? -1) + 1;

        public async Task<AccountGroup> AddGroupAsync(AccountGroup group)
        {
            _context.AccountGroups.Add(group);
            await _context.SaveChangesAsync();
            return group;
        }

        public async Task<Account> AddAccountAsync(Account account)
        {
            _context.Accounts.Add(account);
            await _context.SaveChangesAsync();
            return account;
        }

        public Task SaveAsync() => _context.SaveChangesAsync();

        public async Task DeleteGroupAsync(AccountGroup group)
        {
            _context.AccountGroups.Remove(group);
            await _context.SaveChangesAsync();
        }

        public async Task DeleteAccountAsync(Account account)
        {
            _context.Accounts.Remove(account);
            await _context.SaveChangesAsync();
        }
    }
}
