using MyApp.Api.DTOs;
using MyApp.Api.Models.Accounting;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class AccountService : IAccountService
    {
        private readonly IAccountRepository _repo;

        public AccountService(IAccountRepository repo)
        {
            _repo = repo;
        }

        /// <summary>
        /// An account's live balance, signed debit-positive: a debit balance is
        /// positive, a credit balance negative, whatever the account's type.
        ///
        /// This is the ONE place a balance is computed — the tree, the flat list
        /// and the bank/cash picker all route through it, so they can never
        /// disagree. Today it is the signed opening balance; once the general
        /// ledger posts, journal movement is added on top here and every caller
        /// picks that up without a shape change.
        /// </summary>
        private static decimal LiveBalance(Account a) =>
            a.OpeningBalanceIsDebit ? a.OpeningBalance : -a.OpeningBalance;

        // ── Tree ──────────────────────────────────────────────────────────────

        public async Task<CoaTreeDto> GetTreeAsync(int companyId)
        {
            var groups = await _repo.GetGroupsAsync(companyId);
            var accounts = await _repo.GetAccountsAsync(companyId);

            var accountsByGroup = accounts.GroupBy(a => a.AccountGroupId)
                .ToDictionary(g => g.Key, g => g.OrderBy(a => a.Position).ThenBy(a => a.Id).ToList());
            // Children keyed by NON-NULL parent id — a Dictionary can't hold a
            // null key, and root groups (ParentGroupId == null) are picked out
            // separately below.
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
                // Subtotal = own accounts (debit-positive) + children's subtotals.
                node.OpeningBalanceTotal =
                    node.Accounts.Sum(a => a.OpeningBalanceIsDebit ? a.OpeningBalance : -a.OpeningBalance)
                    + node.Children.Sum(c => c.OpeningBalanceTotal);
                node.BalanceTotal =
                    node.Accounts.Sum(a => a.Balance)
                    + node.Children.Sum(c => c.BalanceTotal);
                return node;
            }

            var roots = groups.Where(g => g.ParentGroupId == null)
                .OrderBy(g => g.Position).ThenBy(g => g.Id).ToList();
            var bs = roots.Where(g => g.Statement == FinancialStatement.BalanceSheet).Select(Build).ToList();
            var pl = roots.Where(g => g.Statement == FinancialStatement.ProfitAndLoss).Select(Build).ToList();

            // Roll the period's net profit into equity as a synthetic
            // "Current-Year Earnings" line — the standard balance-sheet
            // presentation. Net P&L (signed, debit-positive) is the sum of the
            // P&L subtotals; a profit is a net credit (negative), which raises
            // equity. Retained earnings carries its STARTING value, so this adds
            // rather than doubles. Only injected when the P&L has something on
            // it, so a company with no chart is unaffected.
            decimal plBal = pl.Sum(n => n.BalanceTotal);
            decimal plOpen = pl.Sum(n => n.OpeningBalanceTotal);
            if (bs.Count > 0 && (plBal != 0m || plOpen != 0m))
            {
                var equity = bs.FirstOrDefault(n => n.Name.Equals("Equity", StringComparison.OrdinalIgnoreCase)) ?? bs[^1];
                equity.Accounts.Add(new AccountDto
                {
                    Id = 0,
                    CompanyId = companyId,
                    Name = "Current-Year Earnings",
                    AccountType = AccountType.Equity.ToString(),
                    Statement = "BalanceSheet",
                    ControlType = "None",
                    IsActive = true,
                    Position = int.MaxValue,
                    ExternalRef = "__current-year-earnings__",
                    OpeningBalance = Math.Abs(plOpen),
                    OpeningBalanceIsDebit = plOpen >= 0,
                    Balance = plBal,
                });
                equity.OpeningBalanceTotal += plOpen;
                equity.BalanceTotal += plBal;
            }
            return new CoaTreeDto { BalanceSheet = bs, ProfitAndLoss = pl };
        }

        public async Task<List<AccountDto>> GetAccountsFlatAsync(int companyId) =>
            (await _repo.GetAccountsAsync(companyId)).Select(ToDto).ToList();

        public async Task<List<AccountDto>> GetBankCashAccountsAsync(int companyId, bool includeInactive = false)
        {
            var groupNameById = (await _repo.GetGroupsAsync(companyId))
                .ToDictionary(g => g.Id, g => (g.Name ?? "").ToLowerInvariant());
            bool IsBankCashGroup(int gid) =>
                groupNameById.TryGetValue(gid, out var n) && (n.Contains("bank") || n.Contains("cash"));

            // Control-typed BankCash accounts OR asset accounts filed under a
            // bank/cash group — the second arm catches a chart whose bank
            // accounts were created by hand or imported without the flag.
            var rows = (await _repo.GetAccountsAsync(companyId))
                .Where(a => (includeInactive || a.IsActive)
                         && a.AccountType == AccountType.Asset
                         && (a.ControlType == ControlType.BankCash || IsBankCashGroup(a.AccountGroupId)))
                .Select(ToDto).ToList();

            // Management screen: flag which rows are referenced (can't hard-delete).
            // The picker path (includeInactive = false) skips the extra query.
            if (includeInactive)
            {
                var withActivity = await _repo.GetAccountIdsWithActivityAsync(rows.Select(r => r.Id).ToList());
                foreach (var r in rows) r.HasActivity = withActivity.Contains(r.Id);
            }
            return rows;
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

        // ── Groups ────────────────────────────────────────────────────────────

        public async Task<AccountGroupDto> CreateGroupAsync(int companyId, CreateAccountGroupDto dto)
        {
            var name = (dto.Name ?? "").Trim();
            if (name.Length == 0) throw new InvalidOperationException("Group name is required.");

            // Idempotent import: reuse the row when the ExternalRef already exists.
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
                // Walk the chain up from the proposed parent: landing on this
                // group means the move would form a cycle, and a cycle makes the
                // tree builder recurse until the stack goes.
                var cursor = parent;
                var hops = 0;
                while (cursor?.ParentGroupId != null && hops++ < 100)
                {
                    if (cursor.ParentGroupId.Value == g.Id)
                        throw new InvalidOperationException("That move would nest the group inside itself.");
                    cursor = await _repo.GetGroupByIdAsync(cursor.ParentGroupId.Value);
                }
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
                // Pre-check the filtered-unique (CompanyId, Code) index so the
                // operator gets a sentence instead of a raw unique violation.
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
                account.OpeningBalance = dto.OpeningBalance;
                account.OpeningBalanceIsDebit = dto.OpeningBalanceIsDebit;
                account.DefaultLineDescription = Trimmed(dto.DefaultLineDescription);
                account.DefaultTaxRateId = dto.DefaultTaxRateId;
                // IsControlAccount is DERIVED from ControlType server-side — the
                // two can never disagree, and no payload can set one without the
                // other.
                account.IsControlAccount = control != ControlType.None;
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
                OpeningBalance = dto.OpeningBalance,
                OpeningBalanceIsDebit = dto.OpeningBalanceIsDebit,
                DefaultLineDescription = Trimmed(dto.DefaultLineDescription),
                DefaultTaxRateId = dto.DefaultTaxRateId,
                IsControlAccount = control != ControlType.None,
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
            if (dto.OpeningBalance.HasValue) a.OpeningBalance = dto.OpeningBalance.Value;
            if (dto.OpeningBalanceIsDebit.HasValue) a.OpeningBalanceIsDebit = dto.OpeningBalanceIsDebit.Value;
            if (dto.DefaultLineDescription != null) a.DefaultLineDescription = Trimmed(dto.DefaultLineDescription);
            if (dto.DefaultTaxRateId.HasValue) a.DefaultTaxRateId = dto.DefaultTaxRateId.Value == 0 ? null : dto.DefaultTaxRateId.Value;
            if (dto.IsActive.HasValue)
            {
                // Guard deactivation; reactivation is always safe. A singleton
                // posting-role control account (A/R, A/P, tax, inventory,
                // suspense …) would read as MISSING to the posting engine while
                // inactive, which sends its legs to Suspense and splits the
                // books. BankCash is NOT a singleton role — it is chosen per
                // document — so bank/cash accounts stay deactivatable.
                if (!dto.IsActive.Value && a.IsActive
                    && a.IsControlAccount && a.ControlType != ControlType.BankCash)
                {
                    throw new InvalidOperationException(
                        "This is a control account used by the posting engine — it can't be deactivated.");
                }
                a.IsActive = dto.IsActive.Value;
            }
            if (dto.Position.HasValue) a.Position = dto.Position.Value;

            await _repo.SaveAsync();
            return ToDto(a);
        }

        public async Task<AccountDto?> AdjustOpeningBalanceAsync(int id, AdjustOpeningBalanceDto dto)
        {
            var a = await _repo.GetAccountByIdAsync(id);
            if (a == null) return null;
            if (!a.IsActive)
                throw new InvalidOperationException("Reactivate the account before correcting its opening balance.");

            var newAmount = Math.Abs(dto.OpeningBalance);
            // Signed, debit-positive, before and after.
            decimal oldSigned = a.OpeningBalanceIsDebit ? a.OpeningBalance : -a.OpeningBalance;
            decimal newSigned = dto.OpeningBalanceIsDebit ? newAmount : -newAmount;
            decimal delta = newSigned - oldSigned;
            if (delta == 0m) return ToDto(a);   // no-op

            a.OpeningBalance = newAmount;
            a.OpeningBalanceIsDebit = dto.OpeningBalanceIsDebit;

            // Offset the delta on Retained earnings (else Suspense) so the
            // opening balance sheet stays balanced. When the chart has no equity
            // anchor at all we still apply the correction — that company isn't
            // running balanced books yet, and refusing would strand it.
            var candidates = await _repo.GetAccountsAsync(a.CompanyId);
            var offsetInfo = candidates.FirstOrDefault(x => x.ControlType == ControlType.RetainedEarnings)
                          ?? candidates.FirstOrDefault(x => x.ControlType == ControlType.Suspense);
            if (offsetInfo != null && offsetInfo.Id != a.Id)
            {
                var offset = await _repo.GetAccountByIdAsync(offsetInfo.Id);
                if (offset != null)
                {
                    decimal offOld = offset.OpeningBalanceIsDebit ? offset.OpeningBalance : -offset.OpeningBalance;
                    decimal offNew = offOld - delta;   // the opposite side leaves the sum of openings unchanged
                    offset.OpeningBalance = Math.Abs(offNew);
                    offset.OpeningBalanceIsDebit = offNew >= 0m;
                }
            }

            await _repo.SaveAsync();
            return ToDto(a);
        }

        public async Task<bool> DeleteAccountAsync(int id)
        {
            var a = await _repo.GetAccountByIdAsync(id);
            if (a == null) return false;
            // Control accounts are subledger-backed system roles — deactivate,
            // never delete.
            if (a.IsControlAccount)
                throw new InvalidOperationException("Control accounts can't be deleted — deactivate the account instead.");
            // An account with history can't go either (the FKs would refuse it
            // with a raw 500 anyway) — say so, and point at deactivation.
            if (await _repo.AccountHasActivityAsync(id))
                throw new InvalidOperationException("This account has transactions — deactivate it instead of deleting.");
            await _repo.DeleteAccountAsync(a);
            return true;
        }

        // ── Mapping + parsing ─────────────────────────────────────────────────

        private static AccountDto ToDto(Account a) => new()
        {
            Id = a.Id,
            CompanyId = a.CompanyId,
            Name = a.Name,
            Code = a.Code,
            AccountGroupId = a.AccountGroupId,
            AccountGroupName = a.AccountGroup?.Name,
            AccountType = a.AccountType.ToString(),
            Statement = StatementFor(a.AccountType).ToString(),
            CashFlowClass = a.CashFlowClass?.ToString(),
            OpeningBalance = a.OpeningBalance,
            OpeningBalanceIsDebit = a.OpeningBalanceIsDebit,
            DefaultLineDescription = a.DefaultLineDescription,
            DefaultTaxRateId = a.DefaultTaxRateId,
            IsControlAccount = a.IsControlAccount,
            ControlType = a.ControlType.ToString(),
            IsActive = a.IsActive,
            Position = a.Position,
            ExternalRef = a.ExternalRef,
            Balance = LiveBalance(a),
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

        // Enum.TryParse also accepts a NUMERIC string and happily returns an
        // undefined member for it, so "21" would stamp an account with a
        // RESERVED ControlType nothing posts to. Enum.IsDefined is what makes
        // these parsers name-only.
        private static bool TryParseName<TEnum>(string? s, out TEnum value) where TEnum : struct, Enum
        {
            value = default;
            if (string.IsNullOrWhiteSpace(s)) return false;
            if (!Enum.TryParse(s, true, out TEnum parsed) || !Enum.IsDefined(parsed)) return false;
            value = parsed;
            return true;
        }

        private static AccountType ParseAccountType(string? s, FinancialStatement groupStatement)
        {
            if (TryParseName<AccountType>(s, out var t)) return t;
            // Unspecified: pick the sensible default for the group's statement.
            return groupStatement == FinancialStatement.ProfitAndLoss ? AccountType.Expense : AccountType.Asset;
        }

        private static ControlType ParseControlType(string? s) =>
            TryParseName<ControlType>(s, out var c) ? c : ControlType.None;

        private static CashFlowClass? ParseCashFlow(string? s) =>
            TryParseName<CashFlowClass>(s, out var c) ? c : null;
    }
}
