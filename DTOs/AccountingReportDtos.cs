namespace MyApp.Api.DTOs
{
    // Accounting report wire shapes.
    //
    // Every figure here is read from the ledger — journal lines, or a primitive
    // on IGeneralLedgerService. No report re-derives a balance of its own, which
    // is what makes them checkable against each other: two reports that disagree
    // mean a bug, not two defensible opinions.
    //
    // Balances travel SIGNED DEBIT-POSITIVE, the same convention the Chart of
    // Accounts uses. The frontend flips the sign for credit-normal sections so
    // an accountant reads natural numbers.

    public class ReportPeriodDto
    {
        public DateTime? From { get; set; }
        public DateTime? To { get; set; }
    }

    // ── Statements ─────────────────────────────────────────────────────────

    public class StatementLineDto
    {
        public int AccountId { get; set; }
        public string? Code { get; set; }
        public string Name { get; set; } = "";
        public string AccountType { get; set; } = "";
        public string GroupName { get; set; } = "";
        public decimal Amount { get; set; }
    }

    public class StatementSectionDto
    {
        public string Name { get; set; } = "";
        public List<StatementLineDto> Lines { get; set; } = new();
        public decimal Total { get; set; }
    }

    /// <summary>Balance sheet as at a date. Assets less liabilities less equity
    /// must come to zero once the period's earnings are rolled into equity;
    /// <see cref="IsBalanced"/> says whether it does.</summary>
    public class BalanceSheetDto
    {
        public DateTime AsOf { get; set; }
        public List<StatementSectionDto> Assets { get; set; } = new();
        public List<StatementSectionDto> Liabilities { get; set; } = new();
        public List<StatementSectionDto> Equity { get; set; } = new();
        public decimal TotalAssets { get; set; }
        public decimal TotalLiabilities { get; set; }
        public decimal TotalEquity { get; set; }
        /// <summary>The period's net profit, rolled into equity so the sheet
        /// foots. Shown as its own line, not merged into retained earnings.</summary>
        public decimal CurrentEarnings { get; set; }
        public bool IsBalanced { get; set; }
    }

    /// <summary>Profit and loss for a window. Income and expense are reported in
    /// NATURAL sign here (income positive, expense positive) because that is how
    /// the statement reads; the ledger's debit-positive figures are flipped once,
    /// in the service.</summary>
    public class ProfitAndLossDto
    {
        public DateTime? From { get; set; }
        public DateTime? To { get; set; }
        public List<StatementSectionDto> Income { get; set; } = new();
        public List<StatementSectionDto> Expenses { get; set; } = new();
        public decimal TotalIncome { get; set; }
        public decimal TotalExpenses { get; set; }
        public decimal NetProfit { get; set; }
    }

    // ── Party ledger ───────────────────────────────────────────────────────

    public class PartyLedgerRowDto
    {
        public int JournalEntryId { get; set; }
        public int EntryNo { get; set; }
        public DateTime Date { get; set; }
        public string SourceDocType { get; set; } = "";
        public int? SourceDocId { get; set; }
        public string? Reference { get; set; }
        public string? Description { get; set; }
        public decimal Debit { get; set; }
        public decimal Credit { get; set; }
        public decimal RunningBalance { get; set; }
    }

    /// <summary>One party's movement on their control account. Built from the
    /// PartyType/PartyId tags the posting engine writes onto every control line,
    /// so it agrees with the control account by construction.</summary>
    public class PartyLedgerDto
    {
        public string PartyType { get; set; } = "";
        public int PartyId { get; set; }
        public string PartyName { get; set; } = "";
        public DateTime? From { get; set; }
        public DateTime? To { get; set; }
        public decimal OpeningBalance { get; set; }
        public decimal ClosingBalance { get; set; }
        public List<PartyLedgerRowDto> Rows { get; set; } = new();
    }

    // ── Aging ──────────────────────────────────────────────────────────────

    public class AgedPartyRowDto
    {
        public int PartyId { get; set; }
        public string Name { get; set; } = "";
        public int OpenDocuments { get; set; }
        public decimal Total { get; set; }
        public decimal Current { get; set; }
        public decimal Days1To30 { get; set; }
        public decimal Days31To60 { get; set; }
        public decimal Days61To90 { get; set; }
        public decimal Over90 { get; set; }
    }

    public class AgedReportDto
    {
        /// <summary>"Receivables" | "Payables".</summary>
        public string Kind { get; set; } = "";
        public DateTime AsOf { get; set; }
        public List<AgedPartyRowDto> Rows { get; set; } = new();
        public decimal Total { get; set; }
        public decimal Current { get; set; }
        public decimal Days1To30 { get; set; }
        public decimal Days31To60 { get; set; }
        public decimal Days61To90 { get; set; }
        public decimal Over90 { get; set; }
    }

    // ── Cash book ──────────────────────────────────────────────────────────

    public class CashBookAccountDto
    {
        public int AccountId { get; set; }
        public string Name { get; set; } = "";
        public string? Code { get; set; }
        public decimal Opening { get; set; }
        public decimal MoneyIn { get; set; }
        public decimal MoneyOut { get; set; }
        public decimal Closing { get; set; }
    }

    public class CashBookDto
    {
        public DateTime? From { get; set; }
        public DateTime? To { get; set; }
        public List<CashBookAccountDto> Accounts { get; set; } = new();
        public decimal Opening { get; set; }
        public decimal MoneyIn { get; set; }
        public decimal MoneyOut { get; set; }
        public decimal Closing { get; set; }
    }

    // ── Expenses ───────────────────────────────────────────────────────────

    public class ExpenseRowDto
    {
        public int AccountId { get; set; }
        public string Name { get; set; } = "";
        public string GroupName { get; set; } = "";
        public decimal Amount { get; set; }
        /// <summary>Share of the period's total expense, 0–100.</summary>
        public decimal Percent { get; set; }
    }

    public class ExpenseReportDto
    {
        public DateTime? From { get; set; }
        public DateTime? To { get; set; }
        public List<ExpenseRowDto> Rows { get; set; } = new();
        public decimal Total { get; set; }
    }

    // ── Tax control ────────────────────────────────────────────────────────

    /// <summary>One tax account, read from the LEDGER, beside the same figure
    /// re-derived from the DOCUMENTS. The two are computed by different code
    /// from different tables on purpose: a tax report that only reads the ledger
    /// cannot tell you the ledger is wrong.</summary>
    public class TaxControlRowDto
    {
        public string Role { get; set; } = "";
        public string AccountName { get; set; } = "";
        public int? AccountId { get; set; }
        public decimal PerLedger { get; set; }
        public decimal PerDocuments { get; set; }
        public decimal Difference { get; set; }
        public bool Reconciles { get; set; }
    }

    public class TaxControlDto
    {
        public DateTime? From { get; set; }
        public DateTime? To { get; set; }
        public List<TaxControlRowDto> Rows { get; set; } = new();
        /// <summary>True when every row reconciles. False is worth investigating
        /// before a return is filed on these numbers.</summary>
        public bool AllReconcile { get; set; }
    }

    // ── Dashboard ──────────────────────────────────────────────────────────

    /// <summary>The headline figures. Every one of them is the total of a report
    /// that can be opened in full, so the dashboard can be checked against the
    /// thing it summarises rather than being a fourth opinion.</summary>
    public class AccountingDashboardDto
    {
        public DateTime? From { get; set; }
        public DateTime? To { get; set; }
        public decimal Income { get; set; }
        public decimal Expenses { get; set; }
        public decimal NetProfit { get; set; }
        public decimal CashAndBank { get; set; }
        public decimal Receivables { get; set; }
        public decimal Payables { get; set; }
        public decimal OutputTax { get; set; }
        public decimal InputTax { get; set; }
        public decimal FurtherTaxPayable { get; set; }
        public decimal WithholdingReceivable { get; set; }
        public decimal WithholdingPayable { get; set; }
        public int JournalEntries { get; set; }
        public bool LedgerBalances { get; set; }
    }
}
