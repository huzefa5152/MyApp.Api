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
        /// <summary>Catch-all the posting engine falls back to when a role
        /// account is missing — imbalances surface visibly instead of failing
        /// the business operation (the reference product's Suspense account).</summary>
        Suspense = 14,

        // ── Receipt/Payment "settle remainder" adjustment accounts (2026-08-07) ──
        // Where a receipt/payment allocation's non-cash adjustment posts, by
        // (direction × intent). Discount/Write-off are the UI quick-picks; the
        // operator can also route the gap to ANY other account they choose.
        /// <summary>Receipt-side settlement discount (P&amp;L, reduces income).</summary>
        DiscountAllowed = 15,
        /// <summary>Payment-side settlement discount taken from a supplier (P&amp;L income).</summary>
        DiscountReceived = 16,
        /// <summary>Receipt-side write-off of an uncollectible remainder (P&amp;L expense).</summary>
        BadDebtWriteOff = 17,
        /// <summary>Payment-side write-back of an amount no longer owed to a supplier (P&amp;L income).</summary>
        WriteBackIncome = 18,

        /// <summary>SUPERSEDED (2026-08-31) — reserved, never assign 19 to
        /// anything else.
        ///
        /// Briefly (2026-08-29) an unapplied customer receipt posted to a
        /// dedicated "Advance from Customers" liability. That was replaced by
        /// posting an advance to the PARTY's own control account — Accounts
        /// receivable for a client, Accounts payable for a supplier — with the
        /// direction picking the side, which handles customer advances, supplier
        /// advances and both refunds with one rule and keeps the money on the
        /// party's balance where the ledger, the A/R column and the aged reports
        /// can all see it. See PostingService.PostPaymentAsync.
        ///
        /// The member stays because <c>Accounts.ControlType</c> rows stamped with
        /// 19 already exist wherever the seeder or the one-time back-fill ran;
        /// dropping it would leave those rows mapping to an undefined enum value.
        /// Nothing posts here any more and the preset no longer creates the
        /// account, so on an existing chart it is an inert, zero-movement row the
        /// operator can deactivate or delete once its historical balance has been
        /// re-posted (Accounting → rebuild the ledger).</summary>
        CustomerAdvances = 19,
    }
}
