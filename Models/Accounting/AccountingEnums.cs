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

        /// <summary>
        /// Further tax (s.3(1A)) collected on a supply and owed to FBR.
        ///
        /// Kept OUT of <see cref="OutputTax"/> deliberately: the tax reports
        /// read the Output Tax account from the ledger, so mixing a second
        /// rate into it would stop that account reconciling to GST on sales
        /// and lose the check those reports exist to provide.
        /// </summary>
        FurtherTaxPayable = 19,

        /// <summary>SUPERSEDED (2026-08-31), and RENUMBERED 19 → 22 (2026-09-13).
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
        /// The member stays because <c>Accounts.ControlType</c> rows stamped for
        /// it already exist wherever the seeder or the one-time back-fill ran;
        /// dropping it would leave those rows mapping to an undefined enum value.
        /// Nothing posts here any more and the preset no longer creates the
        /// account, so on an existing chart it is an inert, zero-movement row the
        /// operator can deactivate or delete once its historical balance has been
        /// re-posted (Accounting → rebuild the ledger).
        ///
        /// WHY IT MOVED OFF 19: it was declared as an ALIAS of
        /// <see cref="FurtherTaxPayable"/>, so on a chart carrying this legacy
        /// account <c>PostingService.ResolveAsync(FurtherTaxPayable)</c> could
        /// resolve further tax onto "Advance from Customers" — a real liability
        /// credited to the wrong one, with the books still balancing — and
        /// <c>FurtherTaxAccountSeeder</c> read the same row as proof the company
        /// already had a further-tax account and skipped it. Migration
        /// <c>SplitCustomerAdvancesControlType</c> restamps the legacy rows
        /// (keyed on their <c>seed:customer_advances</c> external ref) to 22, so
        /// the seeder then creates the account those charts were missing.</summary>
        CustomerAdvances = 22,

        // NOTE: 19 belongs to FurtherTaxPayable ALONE. CustomerAdvances used to
        // alias it and was moved to 22 on 2026-09-13 (see its doc comment for the
        // misposting that caused). Never reuse a number: an Accounts row stamped
        // with one is how a chart remembers which role an account plays.

        /// <summary>
        /// Where a customs GD's landed-cost liability sits between clearance and
        /// settlement, in New Arrivals mode (<c>GdCostingImportModeNames</c>) —
        /// the accounts-payable answer for an import. The costing sheet names no
        /// supplier and no payment reference, so there is nothing else to credit;
        /// the real payment to the supplier and the clearing agent, once made, is
        /// recorded against this account like any other payable settlement.
        /// Deliberately NOT <see cref="Suspense"/>, which exists to make an
        /// imbalance VISIBLE and would be useless as a destination if every
        /// import were parked there instead of a role account of its own.
        /// </summary>
        ImportClearing = 20,

        /// <summary>
        /// Income tax collected by customs at the time of import, adjustable
        /// against the year's liability — the same "collected now, set off
        /// later" shape as <see cref="WithholdingReceivable"/>, but deliberately
        /// a SEPARATE account rather than a reuse of it:
        /// <c>AccountingReportService.TaxControl.cs</c> labels that one "income
        /// tax withheld BY CUSTOMERS" specifically, and import income tax is
        /// withheld by nobody — it is paid to customs on the declaration. Mixing
        /// a second, unrelated tax into one control account is exactly what kept
        /// <see cref="FurtherTaxPayable"/> out of <see cref="OutputTax"/>; the
        /// same reasoning applies here, the other side of the ledger.
        /// </summary>
        AdvanceIncomeTaxOnImports = 21,
    }
}
