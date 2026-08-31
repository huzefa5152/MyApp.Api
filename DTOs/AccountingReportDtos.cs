using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using MyApp.Api.Helpers;

namespace MyApp.Api.DTOs
{
    // ═══════════════════════════════════════════════════════════════════════════
    //  The reporting envelope.
    //
    //  Every accounting report — all ~100 of them across the phased roadmap —
    //  returns this one shape. That is the whole point: ONE frontend renderer
    //  (ReportShell.jsx) consumes it, so adding a report later is backend-only
    //  work, and the header/totals/export/print behaviour can never drift between
    //  reports because there is only one implementation of each.
    //
    //  Columns travel WITH the data rather than being hardcoded per screen, so a
    //  report that gains a column needs no frontend change.
    // ═══════════════════════════════════════════════════════════════════════════

    /// <summary>How a column renders. <c>Format</c> drives alignment and number
    /// formatting client-side; <c>Key</c> matches the row object's property name
    /// (camelCased by the JSON serializer).</summary>
    public class ReportColumnDto
    {
        public string Key { get; set; } = "";
        public string Label { get; set; } = "";
        /// <summary>"text" | "money" | "date" | "int" | "status".</summary>
        public string Format { get; set; } = "text";
        /// <summary>True when this column should be summed into the totals footer.</summary>
        public bool Totalled { get; set; }
    }

    /// <summary>One row of a "grouped by X" summary block (Expenses by Account,
    /// Expenses by Payee, …). <see cref="DrillKey"/> is the id to filter the detail
    /// report by when the operator clicks through — null when the group has no
    /// drillable identity (e.g. a payee recorded only as free text).</summary>
    public class ReportGroupRowDto
    {
        public string? DrillKey { get; set; }
        public string Label { get; set; } = "";
        public decimal Amount { get; set; }
        public decimal Tax { get; set; }
        public int Count { get; set; }
    }

    /// <summary>A named summary block rendered under a detail report.</summary>
    public class ReportGroupSummaryDto
    {
        /// <summary>Display heading, e.g. "Expenses by Account".</summary>
        public string Title { get; set; } = "";
        /// <summary>Filter key the detail report accepts for a drill-down,
        /// e.g. "accountId" — the frontend appends <c>?{DrillFilter}={DrillKey}</c>.</summary>
        public string? DrillFilter { get; set; }
        public List<ReportGroupRowDto> Rows { get; set; } = new();
        public decimal Total { get; set; }
    }

    /// <summary>
    /// The shared report envelope. Non-generic on purpose: rows are
    /// <c>List&lt;object&gt;</c> so a single controller/service signature and a
    /// single client renderer serve every report. Row shapes are the strongly
    /// typed *Row DTOs below; they are only ever produced, never parsed, server-side.
    /// </summary>
    public class ReportResultDto
    {
        public string Title { get; set; } = "";
        public string CompanyName { get; set; } = "";

        /// <summary>Human period, e.g. "1 Aug 2026 – 31 Aug 2026" or "All periods".</summary>
        public string PeriodLabel { get; set; } = "";
        public DateTime? From { get; set; }
        public DateTime? To { get; set; }

        /// <summary>Every non-default filter, pre-rendered for the report header and
        /// the Excel banner ("Payee: ABC Electricity", "Account: Rent"). Built
        /// server-side so print, screen and Excel state identical provenance.</summary>
        public List<string> FiltersApplied { get; set; } = new();

        public DateTime GeneratedAt { get; set; } = PakistanClock.Now;

        public List<ReportColumnDto> Columns { get; set; } = new();
        public List<object> Rows { get; set; } = new();

        /// <summary>Footer totals keyed by column key, plus derived entries the
        /// columns don't carry (e.g. "transactionCount").</summary>
        public Dictionary<string, decimal> Totals { get; set; } = new();

        /// <summary>
        /// Display names for <see cref="Totals"/> keys. The report names its own
        /// figures because only it knows what they mean: <c>subtotal</c> is "Total
        /// Expenses" on the expense report and would be nonsense as a generic
        /// "Subtotal" elsewhere. Missing keys fall back to a humanised key
        /// client-side, so a new total is never unlabelled.
        /// </summary>
        public Dictionary<string, string> TotalLabels { get; set; } = new();

        public List<ReportGroupSummaryDto> GroupSummaries { get; set; } = new();

        /// <summary>
        /// True when the figures came from the general ledger (JournalLines).
        /// False means the company has GL posting OFF and the report was derived
        /// from the payment/document subledger instead — still correct, but it
        /// cannot see manual journals, so the UI says so rather than implying
        /// ledger completeness.
        /// </summary>
        public bool LedgerSourced { get; set; }

        /// <summary>Set when the export row ceiling truncated the result, so the
        /// operator is never handed a silently short workbook.</summary>
        public string? Notice { get; set; }

        public int Page { get; set; }
        public int PageSize { get; set; }
        public int TotalCount { get; set; }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  Filters
    // ═══════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// The standardised filter set, bound from the query string. A given report
    /// declares which of these it honours (see <c>config/accountingReports.js</c>);
    /// the rest are ignored rather than rejected, so one shape serves every report.
    ///
    /// "Branch" in the request maps to <see cref="DivisionId"/> — this product's
    /// existing reporting dimension, already RBAC-guarded by IDivisionAccessGuard.
    /// </summary>
    public class ReportFilterDto
    {
        /// <summary>Date preset name; see <see cref="ReportPeriod.ParsePreset"/>.
        /// Defaults to all periods when absent.</summary>
        public string? Period { get; set; }
        public DateTime? From { get; set; }
        public DateTime? To { get; set; }

        public int? DivisionId { get; set; }

        /// <summary>Expense/income account, or the cash/bank account for a book.</summary>
        public int? AccountId { get; set; }
        /// <summary>Roll-up dimension the request calls "Expense Group"/"Category".</summary>
        public int? AccountGroupId { get; set; }

        /// <summary>Bank/cash account the money moved through.</summary>
        public int? PaymentAccountId { get; set; }

        /// <summary>"Client" | "Supplier" | "Other" — <c>Payment.ContactType</c>.</summary>
        public string? PayeeType { get; set; }
        /// <summary>Client/Supplier id, meaningful with <see cref="PayeeType"/>.</summary>
        public int? PayeeId { get; set; }

        public int? ClientId { get; set; }
        public int? SupplierId { get; set; }

        /// <summary>Item-type filter for the sales/purchase trade reports.</summary>
        public int? ItemTypeId { get; set; }

        /// <summary>Tax filter: "taxed" | "untaxed" | a rate as a plain number ("18").</summary>
        public string? Tax { get; set; }

        /// <summary>Report-specific status token (cheque status, payment status, …).</summary>
        public string? Status { get; set; }

        /// <summary>Free-text search across the report's text columns.</summary>
        public string? Search { get; set; }

        /// <summary>Column key to sort by; the service validates it against an
        /// allowlist so a caller can never inject an ORDER BY.</summary>
        public string? SortBy { get; set; }
        public bool SortDesc { get; set; }

        /// <summary>Grouping dimension for the "by X" report family:
        /// "account" | "payee" | "group" | "date" | "month" | "paymentAccount" | "tax".</summary>
        public string? GroupBy { get; set; }

        public int Page { get; set; } = 1;
        public int? PageSize { get; set; }

        /// <summary>
        /// Divisions this caller may see, or null when they are unrestricted.
        /// Set by the controller from <c>IDivisionAccessGuard</c> — NEVER by model
        /// binding, which is why it carries <see cref="BindNeverAttribute"/>: a
        /// caller who could put <c>allowedDivisionIds</c> in the query string would
        /// widen their own scope and read other branches' figures.
        ///
        /// A restricted caller also sees company-level records (null DivisionId),
        /// per division-RBAC policy D1 — the query builders encode that.
        /// </summary>
        [BindNever]
        [JsonIgnore]
        public List<int>? AllowedDivisionIds { get; set; }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  Row shapes
    // ═══════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// One expense line. Sourced from a general-ledger debit to an Expense account,
    /// enriched from the source Payment when the entry came from one.
    ///
    /// Amount convention: <see cref="Total"/> is the gross the ledger recorded;
    /// <see cref="Tax"/> is the recoverable slice; <see cref="Subtotal"/> is the
    /// expense actually recognised (Total − Tax). This mirrors
    /// <c>PaymentAllocation</c>, where Amount is gross cash and TaxAmount is the
    /// tax inside it.
    /// </summary>
    public class ExpenseReportRowDto
    {
        public DateTime Date { get; set; }

        /// <summary>"PMT-0042" for a payment-sourced expense, "JE-17" for a manual
        /// journal, "BILL-308" for a purchase bill. There is no Expense document
        /// type in this product — an expense is always some other document's effect.</summary>
        public string DocumentNo { get; set; } = "";
        /// <summary>Source document type + id, for the drill-through to the original.</summary>
        public string SourceType { get; set; } = "";
        public int? SourceId { get; set; }
        public int JournalEntryId { get; set; }

        public string? Payee { get; set; }
        /// <summary>"Client" | "Supplier" | "Other" | null (non-payment source).</summary>
        public string? PayeeType { get; set; }
        public int? PayeeId { get; set; }

        public string? Description { get; set; }

        public int ExpenseAccountId { get; set; }
        public string ExpenseAccount { get; set; } = "";
        /// <summary>The account's group — the request's "Category"/"Expense Group".</summary>
        public int? ExpenseGroupId { get; set; }
        public string? ExpenseGroup { get; set; }

        /// <summary>Bank/cash account the money left from. Null when the expense
        /// did not move cash (a purchase bill accrues to AP; a journal may not
        /// touch cash at all).</summary>
        public string? PaymentAccount { get; set; }
        public int? PaymentAccountId { get; set; }

        public decimal Subtotal { get; set; }
        public decimal Tax { get; set; }
        public decimal Total { get; set; }

        /// <summary>Cheque number / bank reference / supplier bill number.</summary>
        public string? Reference { get; set; }

        public string? Division { get; set; }
    }

    /// <summary>A row of the Payments or Receipts register.</summary>
    public class MoneyRegisterRowDto
    {
        public int PaymentId { get; set; }
        public DateTime Date { get; set; }
        /// <summary>"RCP-0007" / "PMT-0042".</summary>
        public string DocumentNo { get; set; } = "";

        public string? Contact { get; set; }
        /// <summary>"Client" | "Supplier" | "Other".</summary>
        public string ContactType { get; set; } = "";
        public int? ContactId { get; set; }

        /// <summary>Bank/cash account the money moved through.</summary>
        public string? PaymentAccount { get; set; }
        public int? PaymentAccountId { get; set; }
        public string Method { get; set; } = "";

        /// <summary>What the money was applied to, summarised: the settled document
        /// numbers, the income/expense accounts, or "On account (advance)".</summary>
        public string? AppliedTo { get; set; }

        public decimal Amount { get; set; }
        public decimal Tax { get; set; }

        public string? Reference { get; set; }
        public string? Description { get; set; }

        /// <summary>"Cancelled" | "Cheque pending" | "Cheque cleared" | "Bounced"
        /// | "Reconciled" | "Recorded".</summary>
        public string Status { get; set; } = "";
        public string? Division { get; set; }
    }

    /// <summary>
    /// One line of a Cash Book / Bank Book. Same figures the account ledger
    /// produces, presented the way a cashier reads them: money in and money out
    /// instead of debit and credit.
    /// </summary>
    public class CashBookRowDto
    {
        public DateTime Date { get; set; }
        public int JournalEntryId { get; set; }
        public int EntryNo { get; set; }
        public string SourceType { get; set; } = "";
        public int? SourceId { get; set; }
        /// <summary>Document number of the source, when it has one.</summary>
        public string? Reference { get; set; }
        public string? Description { get; set; }
        public string? Contra { get; set; }

        /// <summary>Money in — the debit side of a bank/cash asset account.</summary>
        public decimal Receipt { get; set; }
        /// <summary>Money out — the credit side.</summary>
        public decimal Payment { get; set; }
        /// <summary>Running balance AFTER this row, carried correctly across pages.</summary>
        public decimal Balance { get; set; }
    }

    /// <summary>Cash Book / Bank Book wrapper — the envelope plus the opening and
    /// closing figures a book must state, which the generic Totals map can't
    /// express (they are balances, not column sums).</summary>
    public class CashBookResultDto : ReportResultDto
    {
        public int? AccountId { get; set; }
        public string? AccountName { get; set; }
        public decimal OpeningBalance { get; set; }
        public decimal ClosingBalance { get; set; }
        public decimal TotalReceipts { get; set; }
        public decimal TotalPayments { get; set; }
    }

    /// <summary>One bank/cash account's position, for Cash &amp; Bank Summary.</summary>
    public class CashBankSummaryRowDto
    {
        public int AccountId { get; set; }
        public string Account { get; set; } = "";
        public string? Code { get; set; }
        /// <summary>"Cash" | "Bank" — inferred from the account's group name, the
        /// same resolution the accounting dashboard already uses.</summary>
        public string Kind { get; set; } = "";
        public decimal Opening { get; set; }
        public decimal Receipts { get; set; }
        public decimal Payments { get; set; }
        public decimal Closing { get; set; }
        /// <summary>Cheques recorded against this account but not yet cleared.</summary>
        public decimal UnclearedCheques { get; set; }
    }

    /// <summary>A cheque awaiting clearance — in hand (received) or issued (written).</summary>
    public class ChequeRowDto
    {
        public int PaymentId { get; set; }
        public DateTime Date { get; set; }
        public string DocumentNo { get; set; } = "";
        public string? Contact { get; set; }
        public string? ChequeNumber { get; set; }
        public DateTime? ChequeDate { get; set; }
        /// <summary>"Pending" | "Deposited".</summary>
        public string ChequeStatus { get; set; } = "";
        /// <summary>Negative = overdue by that many days; positive = days until due.
        /// Null when the cheque carries no date.</summary>
        public int? DaysToDue { get; set; }
        public string? PaymentAccount { get; set; }
        public decimal Amount { get; set; }
        public bool IsPostDated { get; set; }
    }

    /// <summary>
    /// Money sitting on a party's account with no document behind it — an advance
    /// received or paid that no invoice/bill has absorbed yet
    /// (<c>AllocationKind.OnAccount</c>). The request calls this
    /// "Unallocated/Unlinked Payments".
    /// </summary>
    public class UnallocatedRowDto
    {
        public int PaymentId { get; set; }
        public DateTime Date { get; set; }
        public string DocumentNo { get; set; } = "";
        /// <summary>"Receipt" | "Payment".</summary>
        public string Direction { get; set; } = "";
        public string? Contact { get; set; }
        public string ContactType { get; set; } = "";
        public int? ContactId { get; set; }
        public string? PaymentAccount { get; set; }
        public decimal Amount { get; set; }
        public string? Description { get; set; }
        public int AgeDays { get; set; }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  Party (customer / supplier) row shapes
    //
    //  Sign convention, stated once because it is the thing most easily got wrong:
    //  the ledger stores everything debit-positive. Receivables are an asset, so a
    //  customer who owes money carries a DEBIT balance and the figures pass through
    //  unchanged. Payables are a liability, so a supplier we owe carries a CREDIT
    //  balance — and "we owe 50,000" has to read as +50,000, not −50,000. The
    //  supplier reports therefore flip the sign of the BALANCE (credit − debit).
    //  The Debit and Credit columns themselves are never flipped.
    // ═══════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// One line of a customer or supplier ledger, taken from the AR/AP control
    /// account's journal lines for that party. Being ledger-sourced, it includes
    /// everything that touched the party's balance — invoices, credit and debit
    /// notes, bills, payments, advances and party-tagged journal entries — not just
    /// the documents any one subledger knows about.
    /// </summary>
    public class PartyLedgerRowDto
    {
        public DateTime Date { get; set; }
        public int JournalEntryId { get; set; }
        public int EntryNo { get; set; }

        /// <summary>What the operator should read: "Sales Invoice", "Credit Note",
        /// "Receipt", "Purchase Bill", "Payment", "Advance", "Journal".</summary>
        public string Transaction { get; set; } = "";
        /// <summary>Human document number: INV-1041, CN-12, RCP-0007, BILL-308.</summary>
        public string Reference { get; set; } = "";
        public string SourceType { get; set; } = "";
        public int? SourceId { get; set; }

        public string? Description { get; set; }

        /// <summary>The party — for the all-parties view. Null when the report is
        /// already scoped to a single party.</summary>
        public string? Party { get; set; }
        public int? PartyId { get; set; }

        public decimal Debit { get; set; }
        public decimal Credit { get; set; }
        /// <summary>Running balance after this row, in the party's natural
        /// direction (see the sign note above).</summary>
        public decimal Balance { get; set; }

        public string? Division { get; set; }
    }

    /// <summary>Party ledger / statement wrapper — the envelope plus the opening
    /// and closing figures a ledger has to state.</summary>
    public class PartyLedgerResultDto : ReportResultDto
    {
        public int? PartyId { get; set; }
        public string? PartyName { get; set; }
        /// <summary>"Client" | "Supplier".</summary>
        public string PartyType { get; set; } = "";

        public decimal OpeningBalance { get; set; }
        public decimal TotalDebit { get; set; }
        public decimal TotalCredit { get; set; }
        public decimal ClosingBalance { get; set; }

        /// <summary>Addressee and letterhead details, so a statement can be sent
        /// out as-is. Populated only when scoped to one party.</summary>
        public PartyContactDto? Party { get; set; }
        public PartyContactDto? CompanyContact { get; set; }

        /// <summary>Age breakdown of the closing balance for the statement footer
        /// ("of which 61–90 days: 12,000"). Null on the plain ledger.</summary>
        public AgingBucketsDto? Aging { get; set; }
    }

    /// <summary>Name and address block for a statement's letterhead or addressee.</summary>
    public class PartyContactDto
    {
        public string Name { get; set; } = "";
        public string? Address { get; set; }
        public string? Phone { get; set; }
        public string? Email { get; set; }
        public string? Ntn { get; set; }
        public string? Strn { get; set; }
    }

    /// <summary>One party's position, for the Customer/Supplier Balance Summary.</summary>
    public class PartyBalanceRowDto
    {
        public int PartyId { get; set; }
        public string Party { get; set; } = "";
        public decimal Opening { get; set; }
        public decimal Debit { get; set; }
        public decimal Credit { get; set; }
        public decimal Closing { get; set; }
        /// <summary>Documents still carrying a balance.</summary>
        public int OpenDocuments { get; set; }
        /// <summary>"Owing" | "Settled" | "In credit".</summary>
        public string Status { get; set; } = "Settled";
    }

    /// <summary>
    /// Balance-summary wrapper. <see cref="Unattributed"/> is the gap between the
    /// AR/AP control account balance and the sum of the party rows — normally zero,
    /// but non-zero when a migration loaded an opening receivable as a lump sum
    /// carrying no party tag. Surfacing it is the whole point: without it the
    /// summary silently disagrees with the Chart of Accounts and nobody can tell why.
    /// </summary>
    public class PartyBalanceSummaryDto : ReportResultDto
    {
        public decimal ControlAccountBalance { get; set; }
        public decimal Unattributed { get; set; }
        public string? ControlAccountName { get; set; }
    }

    /// <summary>
    /// An unpaid sales invoice or purchase bill. "Outstanding" is what is still
    /// collectible or payable: grand total − withholding tax − amount paid, the
    /// same expression the aging report and the payment screens already use.
    /// </summary>
    public class OutstandingDocumentRowDto
    {
        public int DocumentId { get; set; }
        public DateTime Date { get; set; }
        public DateTime? DueDate { get; set; }
        public string DocumentNo { get; set; } = "";
        public string Party { get; set; } = "";
        public int PartyId { get; set; }
        public decimal GrandTotal { get; set; }
        public decimal Tax { get; set; }
        public decimal WithholdingTax { get; set; }
        public decimal Paid { get; set; }
        public decimal Outstanding { get; set; }
        /// <summary>Days past the due date (or the document date when there is
        /// none). Negative means not yet due.</summary>
        public int DaysOverdue { get; set; }
        /// <summary>"Current" | "1-30" | "31-60" | "61-90" | "90+".</summary>
        public string AgeBucket { get; set; } = "Current";
        /// <summary>"Unpaid" | "Partial" | "Overdue".</summary>
        public string Status { get; set; } = "Unpaid";
        public string? Division { get; set; }
    }

    /// <summary>
    /// One line of Customer Sales / Supplier Purchases — document and item level,
    /// so "what did this customer actually buy" is answerable.
    ///
    /// There is deliberately no Discount column: this product stores no discount
    /// field on a document or its lines (a discount is a non-inventory line of its
    /// own, or a settlement adjustment on the payment), so a discount column here
    /// would be invented rather than reported.
    /// </summary>
    public class PartyTradeRowDto
    {
        public DateTime Date { get; set; }
        public int DocumentId { get; set; }
        public string DocumentNo { get; set; } = "";
        /// <summary>"Sales Invoice" | "Credit Note" | "Debit Note" | "Purchase Bill".</summary>
        public string DocumentType { get; set; } = "";
        public string Party { get; set; } = "";
        public int PartyId { get; set; }

        public string? Item { get; set; }
        public string? ItemType { get; set; }
        public int? ItemTypeId { get; set; }
        public decimal Quantity { get; set; }
        public string? Uom { get; set; }
        public decimal UnitPrice { get; set; }
        public decimal LineTotal { get; set; }

        /// <summary>The document's tax apportioned to this line by its share of the
        /// subtotal. Tax is recorded per document, not per line, so this is derived
        /// — the column says "Tax (apportioned)" so nobody reads it as recorded.</summary>
        public decimal Tax { get; set; }
        public decimal Total { get; set; }

        /// <summary>The DOCUMENT's payment status, repeated on each of its lines:
        /// "Paid" | "Partial" | "Unpaid" | "Overdue".</summary>
        public string PaymentStatus { get; set; } = "";
        public string? Division { get; set; }
    }
}
