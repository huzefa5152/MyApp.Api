namespace MyApp.Api.Models.Accounting
{
    /// <summary>Which financial statement an account/group belongs to. Balance
    /// Sheet (assets/liabilities/equity) vs Profit &amp; Loss (income/expense).</summary>
    public enum FinancialStatement { BalanceSheet = 0, ProfitAndLoss = 1 }

    /// <summary>The five classic account natures. Drives default debit/credit
    /// sense and which statement an account rolls up to.</summary>
    public enum AccountType { Asset = 0, Liability = 1, Equity = 2, Income = 3, Expense = 4 }

    /// <summary>Cash-flow-statement classification (Balance Sheet accounts only;
    /// modelled so the column exists, not yet consumed by a report).</summary>
    public enum CashFlowClass { Operating = 0, Investing = 1, Financing = 2, CashEquivalent = 3 }

    /// <summary>
    /// Binds an account to a subledger or a posting role, so detail lives
    /// elsewhere and nothing posts to the control account directly. None = an
    /// ordinary account you post to. The subledger-backed ones
    /// (AR/AP/Inventory/BankCash) resolve their detail from Client / Supplier /
    /// ItemType / bank records; the rest are roles the posting engine targets
    /// by name rather than by id.
    ///
    /// NUMBERING IS FIXED AND SHARED WITH THE OTHER PRODUCTION LINES. An
    /// <c>Accounts.ControlType</c> column is how a chart remembers which role an
    /// account plays, so a number must never be reused for a different meaning —
    /// that is exactly how a second line would silently post further tax onto
    /// somebody's customer-advances liability. Numbers not declared here are
    /// RESERVED, not free:
    ///
    ///   11 ProductionWip, 12 EmployeeClearing — manufacturing/payroll roles this
    ///      line has no documents for.
    ///   20 ImportClearing, 21 AdvanceIncomeTaxOnImports — import-consignment and
    ///      advance-income-tax roles. Both are deliberately out of scope here
    ///      (this line files sales tax, not 236G/236H), so declaring them would
    ///      offer an operator a control type nothing ever posts to.
    ///   22 CustomerAdvances — an unapplied receipt posts to the PARTY's own
    ///      control account (A/R for a client, A/P for a supplier) with the
    ///      direction picking the side. That keeps the money on the party's
    ///      balance where the ledger and the aged reports can see it, and handles
    ///      customer advances, supplier advances and both refunds with one rule.
    ///      A dedicated liability account would be created on every chart and
    ///      never posted to.
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

        /// <summary>Income tax withheld BY our customers on what they pay us —
        /// collected now, set off against the year's liability later.</summary>
        WithholdingReceivable = 9,

        /// <summary>Income tax WE withhold from a supplier's payment and owe to
        /// FBR (s.153).</summary>
        WithholdingPayable = 10,

        // 11 ProductionWip, 12 EmployeeClearing — reserved, see the type remarks.

        Rounding = 13,

        /// <summary>Catch-all the posting engine falls back to when a role
        /// account is missing — an imbalance surfaces visibly on its own account
        /// instead of failing the business operation.</summary>
        Suspense = 14,

        // ── Receipt/Payment "settle remainder" adjustment accounts ──
        // Where a receipt/payment allocation's non-cash adjustment posts, by
        // (direction x intent). Discount / write-off are the UI quick-picks; the
        // operator can also route the gap to any other account they choose.

        /// <summary>Receipt-side settlement discount (P&amp;L, reduces income).</summary>
        DiscountAllowed = 15,
        /// <summary>Payment-side settlement discount taken from a supplier (P&amp;L income).</summary>
        DiscountReceived = 16,
        /// <summary>Receipt-side write-off of an uncollectible remainder (P&amp;L expense).</summary>
        BadDebtWriteOff = 17,
        /// <summary>Payment-side write-back of an amount no longer owed to a supplier (P&amp;L income).</summary>
        WriteBackIncome = 18,

        /// <summary>
        /// Further tax (s.3(1A)) collected on a supply and owed to FBR.
        ///
        /// Kept OUT of <see cref="OutputTax"/> deliberately: the tax reports read
        /// the Output Tax account straight from the ledger, so mixing a second
        /// rate into it would stop that account reconciling to GST on sales and
        /// lose the very check those reports exist to provide.
        /// </summary>
        FurtherTaxPayable = 19,

        // 20 ImportClearing, 21 AdvanceIncomeTaxOnImports, 22 CustomerAdvances —
        // reserved, see the type remarks. Never reuse these numbers.
    }
}
