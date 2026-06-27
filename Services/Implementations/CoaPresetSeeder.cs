using MyApp.Api.Models.Accounting;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// "Wholesale / Distribution" Chart-of-Accounts preset (design §6) — the
    /// differentiator over an empty CoA. Uses the repository directly so it can
    /// set IsSystem on the statement-level groups and control flags on the
    /// subledger-backed accounts. Idempotent via stable "seed:*" ExternalRefs.
    ///
    /// Tax accounts (Input/Output Sales Tax) are seeded WITHOUT a DefaultTaxRateId
    /// for now — binding them to the existing FBR 18% rate is a follow-up once the
    /// posting engine consumes it (design §6).
    /// </summary>
    public class CoaPresetSeeder : ICoaPresetSeeder
    {
        private readonly IAccountRepository _repo;

        public CoaPresetSeeder(IAccountRepository repo)
        {
            _repo = repo;
        }

        public async Task<int> SeedWholesaleAsync(int companyId)
        {
            var created = 0;
            var groupIds = new Dictionary<string, int>(); // externalRef -> id

            async Task<int> Group(string refKey, string name, FinancialStatement stmt, string? parentRef, bool isSystem)
            {
                var er = $"seed:{refKey}";
                var existing = await _repo.GetGroupByExternalRefAsync(companyId, er);
                if (existing != null) { groupIds[refKey] = existing.Id; return existing.Id; }
                int? parentId = parentRef != null && groupIds.TryGetValue(parentRef, out var pid) ? pid : null;
                var g = new AccountGroup
                {
                    CompanyId = companyId,
                    Name = name,
                    Statement = stmt,
                    ParentGroupId = parentId,
                    IsSystem = isSystem,
                    Position = await _repo.NextGroupPositionAsync(companyId, stmt, parentId),
                    ExternalRef = er,
                };
                await _repo.AddGroupAsync(g);
                groupIds[refKey] = g.Id;
                created++;
                return g.Id;
            }

            async Task Account(string refKey, string name, string groupRef, AccountType type,
                ControlType control = ControlType.None)
            {
                var er = $"seed:{refKey}";
                var existing = await _repo.GetAccountByExternalRefAsync(companyId, er);
                if (existing != null) return;
                var groupId = groupIds[groupRef];
                var a = new Models.Accounting.Account
                {
                    CompanyId = companyId,
                    Name = name,
                    AccountGroupId = groupId,
                    AccountType = type,
                    IsControlAccount = control != ControlType.None,
                    ControlType = control,
                    IsActive = true,
                    Position = await _repo.NextAccountPositionAsync(groupId),
                    ExternalRef = er,
                };
                await _repo.AddAccountAsync(a);
                created++;
            }

            // ── Balance Sheet ──
            await Group("assets", "Assets", FinancialStatement.BalanceSheet, null, true);
            await Account("bank_cash", "Bank & Cash", "assets", AccountType.Asset, ControlType.BankCash);
            await Account("ar", "Accounts receivable", "assets", AccountType.Asset, ControlType.AccountsReceivable);
            await Account("inventory", "Inventory on hand", "assets", AccountType.Asset, ControlType.Inventory);
            await Account("input_tax", "Input Sales Tax", "assets", AccountType.Asset, ControlType.InputTax);
            await Group("fixed_assets", "Fixed assets", FinancialStatement.BalanceSheet, "assets", false);

            await Group("liabilities", "Liabilities", FinancialStatement.BalanceSheet, null, true);
            await Account("ap", "Accounts payable", "liabilities", AccountType.Liability, ControlType.AccountsPayable);
            await Account("output_tax", "Output Sales Tax", "liabilities", AccountType.Liability, ControlType.OutputTax);
            await Account("wht_payable", "WHT payable", "liabilities", AccountType.Liability, ControlType.WithholdingPayable);

            await Group("equity", "Equity", FinancialStatement.BalanceSheet, null, true);
            await Account("capital", "Owner's capital", "equity", AccountType.Equity, ControlType.Capital);
            await Account("retained", "Retained earnings", "equity", AccountType.Equity, ControlType.RetainedEarnings);

            // ── Profit & Loss ──
            await Group("income", "Income", FinancialStatement.ProfitAndLoss, null, true);
            await Account("sales", "Sales", "income", AccountType.Income);

            await Group("cogs_grp", "Cost of Sales", FinancialStatement.ProfitAndLoss, null, true);
            await Account("cogs", "Cost of goods sold", "cogs_grp", AccountType.Expense);

            await Group("expenses", "Expenses", FinancialStatement.ProfitAndLoss, null, true);
            foreach (var (key, name) in new[]
            {
                ("exp_salaries", "Salaries"), ("exp_rent", "Rent"), ("exp_utilities", "Utilities"),
                ("exp_freight", "Freight / Cartage"), ("exp_commission", "Commission"),
                ("exp_bank_charges", "Bank charges"), ("exp_discount", "Discount allowed"),
                ("exp_depreciation", "Depreciation"), ("exp_misc", "Miscellaneous"),
            })
            {
                await Account(key, name, "expenses", AccountType.Expense);
            }

            return created;
        }
    }
}
