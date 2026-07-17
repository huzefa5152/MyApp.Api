namespace MyApp.Api.DTOs
{
    // General-ledger wire shapes (Phase B). Amounts follow the CoA convention:
    // debit-positive signed decimals; the frontend renders credits in parens.

    public class GlStatusDto
    {
        public bool Enabled { get; set; }
        public DateTime? LockDate { get; set; }
        public bool HasCoa { get; set; }
        public int AccountCount { get; set; }
        public int EntryCount { get; set; }
        public decimal TotalDebit { get; set; }
        public decimal TotalCredit { get; set; }
        /// <summary>Σ debits == Σ credits over the whole ledger.</summary>
        public bool IsBalanced => TotalDebit == TotalCredit;
    }

    public class GlEnableResultDto
    {
        public bool Enabled { get; set; }
        public int SeededAccounts { get; set; }
        public int PostedInvoices { get; set; }
        public int PostedBills { get; set; }
        public int PostedDebitNotes { get; set; }
        public int PostedPayments { get; set; }
        public int PostedTransfers { get; set; }
        public int RemovedEntries { get; set; }
    }

    public class SetLockDateDto
    {
        public DateTime? LockDate { get; set; }
    }

    // ── Account ledger drill-down ──────────────────────────────────────────

    public class AccountLedgerRowDto
    {
        public int JournalEntryId { get; set; }
        public int EntryNo { get; set; }
        public DateTime Date { get; set; }
        public string SourceDocType { get; set; } = "";
        public int? SourceDocId { get; set; }
        public string? Narration { get; set; }
        public string? Description { get; set; }
        public decimal Debit { get; set; }
        public decimal Credit { get; set; }
        /// <summary>Debit-positive running balance AFTER this row.</summary>
        public decimal RunningBalance { get; set; }
    }

    public class AccountLedgerDto
    {
        public int AccountId { get; set; }
        public string AccountName { get; set; } = "";
        public string? Code { get; set; }
        public string AccountType { get; set; } = "";
        /// <summary>Balance carried into the requested window (signed opening
        /// balance + all movement before the From date).</summary>
        public decimal OpeningBalance { get; set; }
        public decimal ClosingBalance { get; set; }
        public List<AccountLedgerRowDto> Items { get; set; } = new();
        public int TotalCount { get; set; }
        public int Page { get; set; }
        public int PageSize { get; set; }
    }

    // ── Trial balance ──────────────────────────────────────────────────────

    public class TrialBalanceRowDto
    {
        public int AccountId { get; set; }
        public string? Code { get; set; }
        public string Name { get; set; } = "";
        public string AccountType { get; set; } = "";
        /// <summary>Signed (debit-positive) balance carried into the window.</summary>
        public decimal Opening { get; set; }
        public decimal Debit { get; set; }
        public decimal Credit { get; set; }
        public decimal Closing { get; set; }
    }

    public class TrialBalanceDto
    {
        public DateTime? From { get; set; }
        public DateTime? To { get; set; }
        public List<TrialBalanceRowDto> Rows { get; set; } = new();
        public decimal TotalOpening { get; set; }
        public decimal TotalDebit { get; set; }
        public decimal TotalCredit { get; set; }
        public decimal TotalClosing { get; set; }
    }

    // ── AR / AP aging (subledger-derived — works with or without the GL) ──

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

    // ── Accounting summary (dashboard) ─────────────────────────────────────

    public class CashAccountBalanceDto
    {
        public int AccountId { get; set; }
        public string Name { get; set; } = "";
        public string? Code { get; set; }
        public decimal Balance { get; set; }
    }

    public class AgingBucketsDto
    {
        public decimal Total { get; set; }
        public decimal Current { get; set; }
        public decimal Days1To30 { get; set; }
        public decimal Days31To60 { get; set; }
        public decimal Days61To90 { get; set; }
        public decimal Over90 { get; set; }
    }

    public class PdcSummaryDto
    {
        public int Count { get; set; }
        public decimal Amount { get; set; }
        /// <summary>Cheques whose ChequeDate falls within the next 7 days.</summary>
        public int DueSoonCount { get; set; }
        public decimal DueSoonAmount { get; set; }
    }

    public class RecentMoneyDocDto
    {
        public int Id { get; set; }
        public string Reference { get; set; } = "";
        public DateTime Date { get; set; }
        public decimal Amount { get; set; }
        public string? ContactName { get; set; }
        public string? Description { get; set; }
    }

    public class AccountingSummaryDto
    {
        public DateTime From { get; set; }
        public DateTime To { get; set; }
        public bool GlEnabled { get; set; }

        // Cash & liquidity (GL balances; zero/empty until GL is enabled)
        public decimal CashAndBankTotal { get; set; }
        public List<CashAccountBalanceDto> CashAccounts { get; set; } = new();

        // Working capital (subledger — always available)
        public AgingBucketsDto Receivables { get; set; } = new();
        public AgingBucketsDto Payables { get; set; } = new();

        // Profitability for the period (GL)
        public decimal Income { get; set; }
        public decimal Expenses { get; set; }
        public decimal NetProfit { get; set; }

        // Money movement in the period (subledger)
        public int ReceiptCount { get; set; }
        public decimal ReceiptsTotal { get; set; }
        public int PaymentCount { get; set; }
        public decimal PaymentsTotal { get; set; }

        // Post-dated / pending cheques (subledger)
        public PdcSummaryDto PdcIn { get; set; } = new();
        public PdcSummaryDto PdcOut { get; set; } = new();

        public List<RecentMoneyDocDto> RecentReceipts { get; set; } = new();
        public List<RecentMoneyDocDto> RecentPayments { get; set; } = new();
    }
}
