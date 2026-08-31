using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// The accounting reporting engine.
    ///
    /// Every method here READS. Nothing in this service writes a journal entry,
    /// recomputes a balance, or re-derives an accounting rule — the ledger written by
    /// <see cref="IPostingService"/> is the single source of truth, and where a
    /// primitive already exists (<see cref="IGeneralLedgerService.GetAccountLedgerAsync"/>,
    /// <c>GetAccountBalancesAsync</c>, <c>GetTrialBalanceAsync</c>) this service
    /// reuses its semantics rather than reimplementing them. A second accounting
    /// calculation is the one thing a reporting layer must never grow.
    ///
    /// All methods are company-scoped; the controller asserts tenant access and
    /// division access before calling. Returns share one envelope
    /// (<see cref="ReportResultDto"/>) so a single client renderer serves them all.
    /// </summary>
    public interface IAccountingReportService
    {
        /// <summary>True when the company row exists. Lets the controller 404 a
        /// bogus id instead of returning an empty report with a blank letterhead —
        /// [AuthorizeCompany] cannot catch it, because the seed admin is granted
        /// every company unconditionally.</summary>
        Task<bool> CompanyExistsAsync(int companyId);

        // ── Expenses ──────────────────────────────────────────────────────────────

        /// <summary>
        /// Company Expense Report — every debit to an Expense account in the window,
        /// enriched with payee / payment account / reference from the source document.
        /// Row grain is (journal entry × expense account).
        ///
        /// Sourced from the general ledger when the company posts to it; falls back to
        /// the payment subledger otherwise, flagging
        /// <see cref="ReportResultDto.LedgerSourced"/> = false so the caller can say
        /// the figures cannot see manual journals.
        ///
        /// <paramref name="includeGroupSummaries"/> adds the by-Account and by-Payee
        /// breakdown blocks; the "Expense Detail" variant omits them.
        /// </summary>
        Task<ReportResultDto> GetExpenseReportAsync(int companyId, ReportFilterDto filter,
            bool includeGroupSummaries = true, bool forExport = false);

        /// <summary>
        /// The "Expenses by X" family, one method with a grouping dimension:
        /// account | payee | group | date | month | paymentAccount | tax.
        /// Aggregated in SQL — never by materialising detail rows and summing in C#.
        /// </summary>
        Task<ReportResultDto> GetExpenseSummaryAsync(int companyId, ReportFilterDto filter, string groupBy);

        // ── Cash &amp; bank ────────────────────────────────────────────────────────

        /// <summary>
        /// Cash Book / Bank Book. The same figures
        /// <see cref="IGeneralLedgerService.GetAccountLedgerAsync"/> produces for a
        /// bank/cash account, presented as money-in / money-out with a running
        /// balance, opening and closing.
        ///
        /// <paramref name="kind"/>: "cash" | "bank" | "all". When
        /// <see cref="ReportFilterDto.AccountId"/> is set, that one account is used
        /// and <paramref name="kind"/> is ignored.
        /// </summary>
        Task<CashBookResultDto> GetCashBookAsync(int companyId, ReportFilterDto filter, string kind);

        /// <summary>Per-account cash position: opening, receipts, payments, closing,
        /// and uncleared cheques. Reuses <c>GetAccountBalancesAsync</c> for balances.</summary>
        Task<ReportResultDto> GetCashBankSummaryAsync(int companyId, ReportFilterDto filter);

        /// <summary>
        /// Payments or Receipts register. <paramref name="receipts"/> selects the
        /// direction — one implementation, because a receipt and a payment are the
        /// same <c>Payment</c> row with the direction flipped.
        /// </summary>
        Task<ReportResultDto> GetMoneyRegisterAsync(int companyId, ReportFilterDto filter, bool receipts);

        /// <summary>"Payment by Account" / "Receipt by Account" — money grouped by the
        /// income/expense account or settled document type it was applied to.</summary>
        Task<ReportResultDto> GetMoneyByAccountAsync(int companyId, ReportFilterDto filter, bool receipts);

        /// <summary>
        /// Cheques awaiting clearance. <paramref name="issued"/> false = in hand
        /// (received, not yet cleared); true = issued (written, not yet cleared).
        /// Post-dated cheques are flagged, and overdue ones carry a negative
        /// <c>DaysToDue</c>.
        /// </summary>
        Task<ReportResultDto> GetChequeRegisterAsync(int companyId, ReportFilterDto filter, bool issued);

        /// <summary>
        /// Money on a party's account that no invoice or bill has absorbed —
        /// <c>AllocationKind.OnAccount</c> rows. The request's
        /// "Unallocated/Unlinked Payments".
        /// </summary>
        Task<ReportResultDto> GetUnallocatedPaymentsAsync(int companyId, ReportFilterDto filter);

        // -- Customers & suppliers ------------------------------------------------

        /// <summary>
        /// Customer or supplier ledger — every movement on the AR/AP control
        /// account for the party, so invoices, credit and debit notes, bills,
        /// payments, advances and party-tagged journals are all included. Handles a
        /// single party or all of them, any period including all-time, with an
        /// opening balance and a running balance.
        ///
        /// <paramref name="asStatement"/> renders the same figures as a sendable
        /// statement: addressee, letterhead and an age breakdown of the closing
        /// balance. <paramref name="customers"/> false = suppliers.
        /// </summary>
        Task<PartyLedgerResultDto> GetPartyLedgerAsync(int companyId, ReportFilterDto filter,
            bool customers, bool asStatement = false);

        /// <summary>
        /// One line per party: opening, movement, closing, open documents, status.
        /// Reconciles to the AR/AP control account and reports any unattributed
        /// remainder rather than hiding the difference.
        /// </summary>
        Task<PartyBalanceSummaryDto> GetPartyBalanceSummaryAsync(int companyId,
            ReportFilterDto filter, bool customers);

        /// <summary>Unpaid sales invoices / purchase bills, oldest debt first, with
        /// an age bucket per document and a by-party breakdown.</summary>
        Task<ReportResultDto> GetOutstandingDocumentsAsync(int companyId,
            ReportFilterDto filter, bool customers);

        /// <summary>
        /// Customer Sales / Supplier Purchases at document-and-item level, with a
        /// by-item-type breakdown. Document tax is apportioned across lines by
        /// subtotal share, and the column label says so.
        /// </summary>
        Task<ReportResultDto> GetPartyTradeAsync(int companyId, ReportFilterDto filter,
            bool customers);

        /// <summary>
        /// AR/AP aging as a standard report — buckets come straight from
        /// <see cref="IGeneralLedgerService"/> (no second bucket calculation), plus
        /// an as-of date taken from the period end and a per-party drill-down into
        /// the outstanding documents.
        /// </summary>
        Task<ReportResultDto> GetAgingReportAsync(int companyId, ReportFilterDto filter,
            bool customers);

        // -- Financial statements -------------------------------------------------

        /// <summary>
        /// Balance Sheet at the period END (a position, so "from" is ignored), with
        /// the group hierarchy flattened into indented lines. Reuses the Chart of
        /// Accounts' synthetic Current-Year Earnings rule, without which assets
        /// would exceed liabilities plus equity by the net profit. Reports the
        /// balance check on the statement itself.
        ///
        /// <paramref name="comparative"/> adds the same date one year earlier.
        /// </summary>
        Task<StatementResultDto> GetBalanceSheetAsync(int companyId, ReportFilterDto filter,
            bool comparative);

        /// <summary>
        /// Profit &amp; Loss for the period (a flow, so per-account movement rather
        /// than balances). Income is shown positive. A Gross Profit line appears only
        /// when a Cost of Sales group carries activity.
        ///
        /// <paramref name="comparative"/> adds the immediately preceding period of
        /// the same length.
        /// </summary>
        Task<StatementResultDto> GetProfitAndLossAsync(int companyId, ReportFilterDto filter,
            bool comparative);

        /// <summary>
        /// General Ledger — every posting, chronological, across all accounts or one.
        /// A running balance is populated only when scoped to a single account,
        /// because a running total over mixed accounts is meaningless.
        /// </summary>
        Task<ReportResultDto> GetGeneralLedgerAsync(int companyId, ReportFilterDto filter);

        /// <summary>Opening, movement and closing per account, filterable by group
        /// and type. Built on <c>GetTrialBalanceAsync</c> so it cannot disagree with
        /// the Trial Balance.</summary>
        Task<ReportResultDto> GetAccountBalanceSummaryAsync(int companyId, ReportFilterDto filter);

        /// <summary>The existing trial balance, wrapped in the report envelope so it
        /// gains the shared header, print, PDF and Excel.</summary>
        Task<ReportResultDto> GetTrialBalanceReportAsync(int companyId, ReportFilterDto filter);

        // -- Sales & purchases ----------------------------------------------------

        /// <summary>
        /// Sales Invoice Register / Purchase Bill Register: every document with
        /// subtotal, tax, withholding, grand total, paid, outstanding and status.
        /// Figures come from the documents' own stored totals, and status from
        /// <c>PaymentStatusCalculator</c>, so a register row can never disagree with
        /// the document it reports on. <paramref name="sales"/> false = purchases.
        /// </summary>
        Task<ReportResultDto> GetDocumentRegisterAsync(int companyId, ReportFilterDto filter,
            bool sales);

        /// <summary>The register asked a narrower question — same rows, titled and
        /// framed around payment status.</summary>
        Task<ReportResultDto> GetPaymentStatusAsync(int companyId, ReportFilterDto filter,
            bool sales);

        /// <summary>
        /// The "Sales/Purchases by X" family: party | item | itemType | account |
        /// date | month | tax. Item groupings aggregate in SQL over the line tables;
        /// account grouping reads the LEDGER, so it agrees with the P&amp;L rather than
        /// re-deriving the posting engine's account resolution.
        /// </summary>
        Task<ReportResultDto> GetDocumentSummaryAsync(int companyId, ReportFilterDto filter,
            bool sales, string groupBy);

        /// <summary>Sales returns and adjustments — credit and debit notes.</summary>
        Task<ReportResultDto> GetNotesReportAsync(int companyId, ReportFilterDto filter);

        // -- Taxes ----------------------------------------------------------------

        /// <summary>
        /// Output tax owed, input tax reclaimable, and the net position, read from the
        /// Output/Input Tax and withholding control accounts rather than from document
        /// GST fields — so expense input tax and journalled adjustments are included,
        /// and the figures agree with the Balance Sheet.
        /// </summary>
        Task<ReportResultDto> GetTaxSummaryAsync(int companyId, ReportFilterDto filter);

        /// <summary>
        /// Every posting to the tax accounts with the document and party behind it.
        /// <paramref name="output"/> true = output tax, false = input tax,
        /// null = both (Tax Transaction Detail).
        /// </summary>
        Task<ReportResultDto> GetTaxDetailAsync(int companyId, ReportFilterDto filter, bool? output);

        /// <summary>Tax grouped by the customer charged or the supplier paid. Tax with
        /// no party (expense input tax, journals) is reported as unattributed rather
        /// than dropped.</summary>
        Task<ReportResultDto> GetTaxByPartyAsync(int companyId, ReportFilterDto filter, bool customers);

        // -- Accounting control ---------------------------------------------------

        /// <summary>Every journal entry with its source, line count, amount and
        /// whether it balances.</summary>
        Task<ReportResultDto> GetJournalRegisterAsync(int companyId, ReportFilterDto filter);

        /// <summary>
        /// The control report that stands in for "unposted transactions", which this
        /// product has no concept of: postings that landed in Suspense, documents with
        /// no journal entry, and unbalanced entries. Each row says what to do.
        /// </summary>
        Task<ReportResultDto> GetPostingExceptionsAsync(int companyId, ReportFilterDto filter);

        // -- Management -----------------------------------------------------------

        /// <summary>Income or expense by account for the period — the P&amp;L's figures
        /// ordered by size instead of laid out as a statement.</summary>
        Task<ReportResultDto> GetRevenueExpenseSummaryAsync(int companyId, ReportFilterDto filter,
            bool income);

        /// <summary>Month-by-month spend; delegates to the expense engine.</summary>
        Task<ReportResultDto> GetMonthlyExpensesAsync(int companyId, ReportFilterDto filter);

        /// <summary>Money in, out and net by month across the bank and cash accounts.
        /// A cash-movement summary, NOT a statutory statement of cash flows — the
        /// accounts carry no operating/investing/financing classification.</summary>
        Task<ReportResultDto> GetCashFlowSummaryAsync(int companyId, ReportFilterDto filter);
    }
}
