using MyApp.Api.DTOs;
using MyApp.Api.Models.Accounting;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class AccountService : IAccountService
    {
        private readonly IAccountRepository _repo;
        private readonly ILogger<AccountService> _logger;

        public AccountService(IAccountRepository repo, ILogger<AccountService> logger)
        {
            _repo = repo;
            _logger = logger;
        }

        // ── Tree ──────────────────────────────────────────────────────────────

        public async Task<CoaTreeDto> GetTreeAsync(int companyId)
        {
            var groups = await _repo.GetGroupsAsync(companyId);
            var accounts = await _repo.GetAccountsAsync(companyId);
            var accountsByGroup = accounts.GroupBy(a => a.AccountGroupId)
                .ToDictionary(g => g.Key, g => g.OrderBy(a => a.Position).ThenBy(a => a.Id).ToList());
            // Children keyed by NON-NULL parent id (a Dictionary can't hold a null
            // key — root groups have ParentGroupId == null and are handled below).
            var childrenByParent = groups.Where(g => g.ParentGroupId.HasValue)
                .GroupBy(g => g.ParentGroupId!.Value)
                .ToDictionary(g => g.Key, g => g.OrderBy(x => x.Position).ThenBy(x => x.Id).ToList());

            CoaGroupNode Build(AccountGroup g)
            {
                var node = new CoaGroupNode
                {
                    Id = g.Id,
                    Name = g.Name,
                    Statement = g.Statement.ToString(),
                    ParentGroupId = g.ParentGroupId,
                    Position = g.Position,
                    IsSystem = g.IsSystem,
                    ExternalRef = g.ExternalRef,
                    Accounts = accountsByGroup.TryGetValue(g.Id, out var accs)
                        ? accs.Select(ToDto).ToList() : new(),
                    Children = childrenByParent.TryGetValue(g.Id, out var kids)
                        ? kids.Select(Build).ToList() : new(),
                };
                // Subtotal = own accounts (debit-positive) + children subtotals.
                node.OpeningBalanceTotal =
                    node.Accounts.Sum(a => a.OpeningBalanceIsDebit ? a.OpeningBalance : -a.OpeningBalance)
                    + node.Children.Sum(c => c.OpeningBalanceTotal);
                return node;
            }

            var roots = groups.Where(g => g.ParentGroupId == null)
                .OrderBy(g => g.Position).ThenBy(g => g.Id).ToList();
            return new CoaTreeDto
            {
                BalanceSheet = roots.Where(g => g.Statement == FinancialStatement.BalanceSheet).Select(Build).ToList(),
                ProfitAndLoss = roots.Where(g => g.Statement == FinancialStatement.ProfitAndLoss).Select(Build).ToList(),
            };
        }

        public async Task<List<AccountDto>> GetAccountsFlatAsync(int companyId) =>
            (await _repo.GetAccountsAsync(companyId)).Select(ToDto).ToList();

        public async Task<List<AccountDto>> GetBankCashAccountsAsync(int companyId)
        {
            var groupNameById = (await _repo.GetGroupsAsync(companyId))
                .ToDictionary(g => g.Id, g => (g.Name ?? "").ToLowerInvariant());
            bool IsBankCashGroup(int gid) =>
                groupNameById.TryGetValue(gid, out var n) && (n.Contains("bank") || n.Contains("cash"));

            return (await _repo.GetAccountsAsync(companyId))
                .Where(a => a.IsActive
                         && a.AccountType == AccountType.Asset
                         && (a.ControlType == ControlType.BankCash || IsBankCashGroup(a.AccountGroupId)))
                .Select(ToDto).ToList();
        }

        public async Task<AccountDto?> GetAccountByIdAsync(int id)
        {
            var a = await _repo.GetAccountByIdAsync(id);
            return a == null ? null : ToDto(a);
        }

        public async Task<AccountGroupDto?> GetGroupByIdAsync(int id)
        {
            var g = await _repo.GetGroupByIdAsync(id);
            return g == null ? null : ToGroupDto(g);
        }

        // ── Groups ──────────────────────────────────────────────────────────────

        public async Task<AccountGroupDto> CreateGroupAsync(int companyId, CreateAccountGroupDto dto)
        {
            var name = (dto.Name ?? "").Trim();
            if (name.Length == 0) throw new InvalidOperationException("Group name is required.");

            // Idempotent import: reuse the row when ExternalRef already exists.
            if (!string.IsNullOrWhiteSpace(dto.ExternalRef))
            {
                var existing = await _repo.GetGroupByExternalRefAsync(companyId, dto.ExternalRef.Trim());
                if (existing != null)
                {
                    existing.Name = name;
                    await _repo.SaveAsync();
                    return ToGroupDto(existing);
                }
            }

            var statement = ParseStatement(dto.Statement);
            int? parentId = dto.ParentGroupId;
            if (parentId.HasValue)
            {
                var parent = await _repo.GetGroupByIdAsync(parentId.Value);
                if (parent == null || parent.CompanyId != companyId)
                    throw new InvalidOperationException("Parent group does not belong to this company.");
                statement = parent.Statement; // a sub-group inherits its parent's statement
            }

            var group = new AccountGroup
            {
                CompanyId = companyId,
                Name = name,
                Statement = statement,
                ParentGroupId = parentId,
                Position = await _repo.NextGroupPositionAsync(companyId, statement, parentId),
                ExternalRef = string.IsNullOrWhiteSpace(dto.ExternalRef) ? null : dto.ExternalRef.Trim(),
            };
            await _repo.AddGroupAsync(group);
            return ToGroupDto(group);
        }

        public async Task<AccountGroupDto?> UpdateGroupAsync(int id, UpdateAccountGroupDto dto)
        {
            var g = await _repo.GetGroupByIdAsync(id);
            if (g == null) return null;
            if (g.IsSystem && !string.IsNullOrWhiteSpace(dto.Name) && dto.Name.Trim() != g.Name)
                throw new InvalidOperationException("System statement groups can't be renamed.");

            if (!string.IsNullOrWhiteSpace(dto.Name)) g.Name = dto.Name.Trim();
            if (dto.Position.HasValue) g.Position = dto.Position.Value;
            if (dto.ParentGroupId.HasValue)
            {
                if (dto.ParentGroupId.Value == g.Id)
                    throw new InvalidOperationException("A group can't be its own parent.");
                var parent = await _repo.GetGroupByIdAsync(dto.ParentGroupId.Value);
                if (parent == null || parent.CompanyId != g.CompanyId)
                    throw new InvalidOperationException("Parent group does not belong to this company.");
                if (parent.Statement != g.Statement)
                    throw new InvalidOperationException("A group can't move to a different statement.");
                g.ParentGroupId = dto.ParentGroupId.Value;
            }
            await _repo.SaveAsync();
            return ToGroupDto(g);
        }

        public async Task<bool> DeleteGroupAsync(int id)
        {
            var g = await _repo.GetGroupByIdAsync(id);
            if (g == null) return false;
            if (g.IsSystem)
                throw new InvalidOperationException("System statement groups can't be deleted.");
            if (await _repo.GroupHasChildrenAsync(id))
                throw new InvalidOperationException("This group still holds accounts or sub-groups — move or delete them first.");
            await _repo.DeleteGroupAsync(g);
            return true;
        }

        // ── Accounts ──────────────────────────────────────────────────────────

        public async Task<AccountDto> CreateAccountAsync(int companyId, CreateAccountDto dto)
        {
            var name = (dto.Name ?? "").Trim();
            if (name.Length == 0) throw new InvalidOperationException("Account name is required.");

            var group = await _repo.GetGroupByIdAsync(dto.AccountGroupId);
            if (group == null || group.CompanyId != companyId)
                throw new InvalidOperationException("Account group does not belong to this company.");

            var type = ParseAccountType(dto.AccountType, group.Statement);
            var control = ParseControlType(dto.ControlType);

            // Idempotent import: upsert on ExternalRef.
            Account? account = null;
            if (!string.IsNullOrWhiteSpace(dto.ExternalRef))
                account = await _repo.GetAccountByExternalRefAsync(companyId, dto.ExternalRef.Trim());

            var code = string.IsNullOrWhiteSpace(dto.Code) ? null : dto.Code.Trim();
            if (code != null)
            {
                // Pre-check the filtered-unique (CompanyId, Code) so we return a
                // friendly message instead of a raw DB unique violation.
                var clash = (await _repo.GetAccountsAsync(companyId))
                    .FirstOrDefault(a => a.Code == code && a.Id != (account?.Id ?? 0));
                if (clash != null)
                    throw new InvalidOperationException($"Account code '{code}' is already used by '{clash.Name}'.");
            }

            if (account != null)
            {
                account.Name = name;
                account.Code = code;
                account.AccountGroupId = group.Id;
                account.AccountType = type;
                account.CashFlowClass = ParseCashFlow(dto.CashFlowClass);
                account.DivisionId = dto.DivisionId;
                account.OpeningBalance = dto.OpeningBalance;
                account.OpeningBalanceIsDebit = dto.OpeningBalanceIsDebit;
                account.DefaultLineDescription = Trimmed(dto.DefaultLineDescription);
                account.DefaultTaxRateId = dto.DefaultTaxRateId;
                account.IsControlAccount = dto.IsControlAccount;
                account.ControlType = control;
                await _repo.SaveAsync();
                return ToDto(account);
            }

            account = new Account
            {
                CompanyId = companyId,
                Name = name,
                Code = code,
                AccountGroupId = group.Id,
                AccountType = type,
                CashFlowClass = ParseCashFlow(dto.CashFlowClass),
                DivisionId = dto.DivisionId,
                OpeningBalance = dto.OpeningBalance,
                OpeningBalanceIsDebit = dto.OpeningBalanceIsDebit,
                DefaultLineDescription = Trimmed(dto.DefaultLineDescription),
                DefaultTaxRateId = dto.DefaultTaxRateId,
                IsControlAccount = dto.IsControlAccount,
                ControlType = control,
                IsActive = true,
                Position = await _repo.NextAccountPositionAsync(group.Id),
                ExternalRef = string.IsNullOrWhiteSpace(dto.ExternalRef) ? null : dto.ExternalRef.Trim(),
            };
            await _repo.AddAccountAsync(account);
            return ToDto(account);
        }

        public async Task<AccountDto?> UpdateAccountAsync(int id, UpdateAccountDto dto)
        {
            var a = await _repo.GetAccountByIdAsync(id);
            if (a == null) return null;

            if (!string.IsNullOrWhiteSpace(dto.Name)) a.Name = dto.Name.Trim();
            if (dto.Code != null)
            {
                var code = string.IsNullOrWhiteSpace(dto.Code) ? null : dto.Code.Trim();
                if (code != null)
                {
                    var clash = (await _repo.GetAccountsAsync(a.CompanyId)).FirstOrDefault(x => x.Code == code && x.Id != a.Id);
                    if (clash != null) throw new InvalidOperationException($"Account code '{code}' is already used by '{clash.Name}'.");
                }
                a.Code = code;
            }
            if (dto.AccountGroupId.HasValue)
            {
                var group = await _repo.GetGroupByIdAsync(dto.AccountGroupId.Value);
                if (group == null || group.CompanyId != a.CompanyId)
                    throw new InvalidOperationException("Account group does not belong to this company.");
                a.AccountGroupId = group.Id;
            }
            if (dto.CashFlowClass != null) a.CashFlowClass = ParseCashFlow(dto.CashFlowClass);
            if (dto.DivisionId.HasValue) a.DivisionId = dto.DivisionId.Value == 0 ? null : dto.DivisionId.Value;
            if (dto.OpeningBalance.HasValue) a.OpeningBalance = dto.OpeningBalance.Value;
            if (dto.OpeningBalanceIsDebit.HasValue) a.OpeningBalanceIsDebit = dto.OpeningBalanceIsDebit.Value;
            if (dto.DefaultLineDescription != null) a.DefaultLineDescription = Trimmed(dto.DefaultLineDescription);
            if (dto.DefaultTaxRateId.HasValue) a.DefaultTaxRateId = dto.DefaultTaxRateId.Value == 0 ? null : dto.DefaultTaxRateId.Value;
            if (dto.IsActive.HasValue) a.IsActive = dto.IsActive.Value;
            if (dto.Position.HasValue) a.Position = dto.Position.Value;

            await _repo.SaveAsync();
            return ToDto(a);
        }

        public async Task<bool> DeleteAccountAsync(int id)
        {
            var a = await _repo.GetAccountByIdAsync(id);
            if (a == null) return false;
            // Control accounts are subledger-backed system roles — block delete
            // (design §7). Operators deactivate instead.
            if (a.IsControlAccount)
                throw new InvalidOperationException("Control accounts can't be deleted — deactivate the account instead.");
            await _repo.DeleteAccountAsync(a);
            return true;
        }

        // ── Mapping + parsing ───────────────────────────────────────────────────

        private static AccountDto ToDto(Account a) => new()
        {
            Id = a.Id,
            CompanyId = a.CompanyId,
            Name = a.Name,
            Code = a.Code,
            AccountGroupId = a.AccountGroupId,
            AccountType = a.AccountType.ToString(),
            Statement = StatementFor(a.AccountType).ToString(),
            CashFlowClass = a.CashFlowClass?.ToString(),
            DivisionId = a.DivisionId,
            OpeningBalance = a.OpeningBalance,
            OpeningBalanceIsDebit = a.OpeningBalanceIsDebit,
            DefaultLineDescription = a.DefaultLineDescription,
            DefaultTaxRateId = a.DefaultTaxRateId,
            IsControlAccount = a.IsControlAccount,
            ControlType = a.ControlType.ToString(),
            IsActive = a.IsActive,
            Position = a.Position,
            ExternalRef = a.ExternalRef,
        };

        private static AccountGroupDto ToGroupDto(AccountGroup g) => new()
        {
            Id = g.Id,
            CompanyId = g.CompanyId,
            Name = g.Name,
            Statement = g.Statement.ToString(),
            ParentGroupId = g.ParentGroupId,
            Position = g.Position,
            IsSystem = g.IsSystem,
            ExternalRef = g.ExternalRef,
        };

        private static string? Trimmed(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

        /// <summary>Which statement a type rolls up to: Income/Expense → P&amp;L,
        /// everything else (Asset/Liability/Equity) → Balance Sheet.</summary>
        private static FinancialStatement StatementFor(AccountType t) =>
            t == AccountType.Income || t == AccountType.Expense
                ? FinancialStatement.ProfitAndLoss : FinancialStatement.BalanceSheet;

        private static FinancialStatement ParseStatement(string? s) =>
            string.Equals(s, "ProfitAndLoss", StringComparison.OrdinalIgnoreCase) || string.Equals(s, "PL", StringComparison.OrdinalIgnoreCase)
                ? FinancialStatement.ProfitAndLoss : FinancialStatement.BalanceSheet;

        private static AccountType ParseAccountType(string? s, FinancialStatement groupStatement)
        {
            if (!string.IsNullOrWhiteSpace(s) && Enum.TryParse<AccountType>(s, true, out var t)) return t;
            // Fallback when unspecified: pick a sensible default for the statement.
            return groupStatement == FinancialStatement.ProfitAndLoss ? AccountType.Expense : AccountType.Asset;
        }

        private static ControlType ParseControlType(string? s) =>
            !string.IsNullOrWhiteSpace(s) && Enum.TryParse<ControlType>(s, true, out var c) ? c : ControlType.None;

        private static CashFlowClass? ParseCashFlow(string? s) =>
            !string.IsNullOrWhiteSpace(s) && Enum.TryParse<CashFlowClass>(s, true, out var c) ? c : null;
    }
}
