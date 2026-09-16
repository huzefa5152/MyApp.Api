namespace MyApp.Api.DTOs
{
    // General-ledger wire shapes. Amounts follow the Chart-of-Accounts
    // convention: signed debit-positive decimals, with the frontend rendering a
    // credit in parentheses. Raw Debit/Credit columns stay unsigned.

    /// <summary>Whether this company's ledger is live, when its last period was
    /// closed, and whether the whole ledger still balances. There is no
    /// "disable" counterpart on purpose — see <c>Company.GlPostingEnabled</c>.</summary>
    public class GlStatusDto
    {
        public bool Enabled { get; set; }
        public DateTime? LockDate { get; set; }
        public bool HasCoa { get; set; }
        public int AccountCount { get; set; }
        public int EntryCount { get; set; }
        public decimal TotalDebit { get; set; }
        public decimal TotalCredit { get; set; }

        /// <summary>SUM(debits) == SUM(credits) across the whole ledger. False
        /// is not a rounding artefact — every entry is refused unless it
        /// balances, so a false here means something wrote around the service.</summary>
        public bool IsBalanced => TotalDebit == TotalCredit;
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
        public int CompanyId { get; set; }
        public string AccountName { get; set; } = "";
        public string? Code { get; set; }
        public string AccountType { get; set; } = "";

        /// <summary>Balance carried INTO the requested window: the signed
        /// opening balance plus every movement dated before From.</summary>
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

        /// <summary>The movement columns must foot to each other. Openings are
        /// entered per account and need not, which is why they are reported
        /// separately rather than folded into this check.</summary>
        public bool IsBalanced => TotalDebit == TotalCredit;
    }
}
