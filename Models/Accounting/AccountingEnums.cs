namespace MyApp.Api.Models.Accounting
{
    /// <summary>Which financial statement an account/group belongs to. Balance
    /// Sheet (assets/liabilities/equity) vs Profit &amp; Loss (income/expense).</summary>
    public enum FinancialStatement { BalanceSheet = 0, ProfitAndLoss = 1 }

    /// <summary>The five classic account natures. Drives default debit/credit
    /// sense and which statement an account rolls up to.</summary>
    public enum AccountType { Asset = 0, Liability = 1, Equity = 2, Income = 3, Expense = 4 }

    /// <summary>Cash-flow-statement classification (Balance Sheet accounts only;
    /// deferred in v1 but modelled so the column exists).</summary>
    public enum CashFlowClass { Operating = 0, Investing = 1, Financing = 2, CashEquivalent = 3 }

    /// <summary>
    /// Binds an account to a subledger so detail lives elsewhere and you don't
    /// post to the control account directly. None = an ordinary account you post
    /// to. The subledger-backed ones (AR/AP/Inventory/BankCash) resolve their
    /// detail from Client / Supplier / ItemType / bank records. The rest are
    /// system roles the posting engine and FBR wiring will target later.
    /// </summary>
    public enum ControlType
    {
        None = 0,
        AccountsReceivable = 1,
        AccountsPayable = 2,
        Inventory = 3,
        BankCash = 4,
        Capital = 5,
        RetainedEarnings = 6,
        OutputTax = 7,
        InputTax = 8,
        WithholdingReceivable = 9,
        WithholdingPayable = 10,
        ProductionWip = 11,
        EmployeeClearing = 12,
        Rounding = 13,
    }
}
