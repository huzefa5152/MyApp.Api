using MyApp.Api.Models.Accounting;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// The "Wholesale / Distribution" Chart-of-Accounts preset — what turns an
    /// empty chart into a usable one. Talks to the repository rather than the
    /// account service so it can set <c>IsSystem</c> on the statement-level
    /// groups and the control flags on the subledger-backed accounts, neither of
    /// which an operator may set through the API.
    ///
    /// Idempotent through stable <c>"seed:*"</c> ExternalRefs: running it on a
    /// chart that already has the preset adds only what is missing, so it is safe
    /// to re-run after the preset itself gains a row.
    ///
    /// Tax accounts (Input/Output Sales Tax) are seeded WITHOUT a
    /// DefaultTaxRateId — binding them to an FBR rate only makes sense once the
    /// posting engine consumes it.
    ///
    /// No Suspense account is seeded: the posting engine creates it on demand,
    /// and an always-present, always-empty Suspense row on every chart trains
    /// operators to ignore the one account whose whole job is to be noticed.
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
            var groupIds = new Dictionary<string, int>(); // externalRef key -> id

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
            // Income tax our CUSTOMERS withhold from what they pay us (s.153),
            // set off against the year's liability.
            await Account("wht_receivable", "WHT receivable", "assets", AccountType.Asset, ControlType.WithholdingReceivable);
            await Account("prepaid", "Prepaid expenses", "assets", AccountType.Asset);
            await Group("fixed_assets", "Fixed assets", FinancialStatement.BalanceSheet, "assets", false);

            await Group("liabilities", "Liabilities", FinancialStatement.BalanceSheet, null, true);
            await Account("ap", "Accounts payable", "liabilities", AccountType.Liability, ControlType.AccountsPayable);
            await Account("output_tax", "Output Sales Tax", "liabilities", AccountType.Liability, ControlType.OutputTax);
            // Further tax (s.3(1A)) gets its OWN liability, never Output Sales
            // Tax — see ControlType.FurtherTaxPayable for why mixing them breaks
            // the tax reports' reconciliation.
            await Account("further_tax_payable", "Further Tax Payable", "liabilities", AccountType.Liability, ControlType.FurtherTaxPayable);
            // Income tax WE withhold from a supplier's payment and owe to FBR.
            await Account("wht_payable", "WHT payable", "liabilities", AccountType.Liability, ControlType.WithholdingPayable);
            await Account("loans_payable", "Loans payable", "liabilities", AccountType.Liability);

            await Group("equity", "Equity", FinancialStatement.BalanceSheet, null, true);
            // The owner's stake. Capital and Retained earnings are control-typed
            // because the posting engine resolves them by role; Drawings is a
            // plain account the owner may rename.
            await Account("capital", "Owner's capital", "equity", AccountType.Equity, ControlType.Capital);
            await Account("drawings", "Owner drawings", "equity", AccountType.Equity);
            await Account("retained", "Retained earnings", "equity", AccountType.Equity, ControlType.RetainedEarnings);

            // ── Profit & Loss ──
            await Group("income", "Income", FinancialStatement.ProfitAndLoss, null, true);
            await Account("sales", "Sales", "income", AccountType.Income);
            await Account("service_revenue", "Service revenue", "income", AccountType.Income);
            await Account("other_income", "Other income", "income", AccountType.Income);

            await Group("cogs_grp", "Cost of Sales", FinancialStatement.ProfitAndLoss, null, true);
            await Account("cogs", "Cost of goods sold", "cogs_grp", AccountType.Expense);

            await Group("expenses", "Expenses", FinancialStatement.ProfitAndLoss, null, true);
            // The everyday spending categories, so recording an expense works the
            // moment a company is seeded instead of sending the operator to the
            // Chart of Accounts first. All plain (non-control) accounts: rename,
            // deactivate or delete any that don't apply, and add your own.
            foreach (var (key, name) in new[]
            {
                ("exp_salaries", "Salaries"), ("exp_rent", "Rent"), ("exp_utilities", "Utilities"),
                ("exp_electricity", "Electricity"), ("exp_internet", "Internet"),
                ("exp_telephone", "Telephone"), ("exp_office_supplies", "Office supplies"),
                ("exp_travel", "Travel & conveyance"), ("exp_repairs", "Repairs & maintenance"),
                ("exp_marketing", "Marketing & advertising"),
                ("exp_professional", "Professional fees"),
                ("exp_freight", "Freight / Cartage"), ("exp_commission", "Commission"),
                ("exp_bank_charges", "Bank charges"),
                ("exp_depreciation", "Depreciation"), ("exp_misc", "Miscellaneous"),
            })
            {
                await Account(key, name, "expenses", AccountType.Expense);
            }

            // Receipt/Payment "settle remainder" adjustment accounts — the
            // quick-pick targets for the discount / write-off gap on a receipt or
            // payment. The operator can also route the gap to any other account.
            await Account("disc_allowed", "Discount allowed", "expenses", AccountType.Expense, ControlType.DiscountAllowed);
            await Account("bad_debts", "Bad debts written off", "expenses", AccountType.Expense, ControlType.BadDebtWriteOff);
            await Account("disc_received", "Discount received", "income", AccountType.Income, ControlType.DiscountReceived);
            await Account("writeback", "Sundry balances written back", "income", AccountType.Income, ControlType.WriteBackIncome);

            return created;
        }
    }
}
