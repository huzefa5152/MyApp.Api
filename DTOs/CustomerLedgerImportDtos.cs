namespace MyApp.Api.DTOs
{
    /// <summary>How a customer sheet was paired with a row of the index sheet.</summary>
    public static class LedgerClientMatch
    {
        /// <summary>Names agree exactly once normalised.</summary>
        public const string Exact = "exact";

        /// <summary>Close enough to suggest, not close enough to assume. The
        /// operator confirms — a wrong pairing puts one customer's invoices on
        /// another's account.</summary>
        public const string Fuzzy = "fuzzy";

        /// <summary>A sheet with no index row, or an index row with no sheet.</summary>
        public const string Unmatched = "unmatched";
    }

    /// <summary>One customer as the importer read them, with the reconciliation
    /// that says whether the numbers agree with the source.</summary>
    public class LedgerClientPreviewDto
    {
        /// <summary>Row on the index sheet. Also the key the opening document's
        /// number is derived from, so it has to be stable.</summary>
        public int IndexRow { get; set; }

        /// <summary>Name as the index sheet gives it.</summary>
        public string IndexName { get; set; } = "";

        /// <summary>Name as the customer's own sheet gives it, when they differ.</summary>
        public string? SheetName { get; set; }

        /// <summary>Worksheet tab the transactions came from.</summary>
        public string? SheetTab { get; set; }

        /// <summary>One of <see cref="LedgerClientMatch"/>.</summary>
        public string MatchKind { get; set; } = LedgerClientMatch.Exact;

        /// <summary>Existing client in this company this will be written to.
        /// Null means a new client is created.</summary>
        public int? ClientId { get; set; }
        public string? ExistingClientName { get; set; }

        public decimal Opening { get; set; }
        public decimal TotalCredit { get; set; }
        public decimal TotalDebit { get; set; }

        /// <summary>Opening + Credit − Debit, worked out from the rows.</summary>
        public decimal ComputedClosing { get; set; }

        /// <summary>Closing as the index sheet states it.</summary>
        public decimal StatedClosing { get; set; }

        /// <summary>ComputedClosing − StatedClosing. Must be zero.</summary>
        public decimal Difference { get; set; }

        public int InvoiceCount { get; set; }
        public int ReceiptCount { get; set; }

        /// <summary>Rows whose date was inferred rather than read.</summary>
        public int UndatedRowCount { get; set; }

        public List<string> Warnings { get; set; } = new();
    }

    /// <summary>An invoice the importer would create.</summary>
    public class LedgerInvoiceDto
    {
        public int IndexRow { get; set; }
        public string? Reference { get; set; }
        public int InvoiceNumber { get; set; }
        public DateTime Date { get; set; }
        public decimal Amount { get; set; }

        /// <summary>Sheet rows that fed this invoice. More than one means the
        /// same reference was written across several lines and they have been
        /// added together.</summary>
        public List<int> SourceRows { get; set; } = new();

        /// <summary>True for the synthetic document carrying a customer's
        /// opening balance rather than a real invoice from the sheet.</summary>
        public bool IsOpening { get; set; }
    }

    /// <summary>A receipt the importer would create.</summary>
    public class LedgerReceiptDto
    {
        public int IndexRow { get; set; }
        public int SourceRow { get; set; }
        public DateTime Date { get; set; }
        public decimal Amount { get; set; }

        /// <summary>Cash | Bank Transfer | Cheque | Other, read from the row's
        /// narrative.</summary>
        public string Method { get; set; } = "Cash";

        /// <summary>The row's narrative, kept when it carries a bank or cheque
        /// reference worth preserving.</summary>
        public string? Description { get; set; }

        /// <summary>True for the receipt that carries a NEGATIVE opening balance
        /// — a customer who had paid ahead. A negative invoice would corrupt
        /// totals and print, so it becomes money received instead.</summary>
        public bool IsOpening { get; set; }
    }

    public class CustomerLedgerPreviewDto
    {
        public string FileName { get; set; } = "";
        public string FileSha256 { get; set; } = "";
        public long FileSizeBytes { get; set; }
        public int? ImportProfileId { get; set; }
        public int? ProfileVersion { get; set; }

        public List<LedgerClientPreviewDto> Clients { get; set; } = new();
        public List<LedgerInvoiceDto> Invoices { get; set; } = new();
        public List<LedgerReceiptDto> Receipts { get; set; } = new();

        public int NewClientCount { get; set; }
        public int ExistingClientCount { get; set; }

        public decimal TotalOpening { get; set; }
        public decimal TotalCredit { get; set; }
        public decimal TotalDebit { get; set; }

        /// <summary>Sum of every customer's computed closing.</summary>
        public decimal TotalComputedClosing { get; set; }

        /// <summary>Total the index sheet itself states, when it carries one.</summary>
        public decimal TotalStatedClosing { get; set; }

        /// <summary>Customers whose computed closing disagrees with the index.
        /// Any at all blocks the import.</summary>
        public int ClientsOutOfBalance { get; set; }

        public DateTime PeriodEnd { get; set; }
        public DateTime OpeningDate { get; set; }

        public List<string> BlockingErrors { get; set; } = new();
        public List<string> Warnings { get; set; } = new();

        public bool CanCommit => BlockingErrors.Count == 0 && Clients.Count > 0;
    }

    /// <summary>
    /// Commit takes the REVIEWED result, not the file again. The client list
    /// carries the operator's confirmed pairings, so a fuzzy name match they
    /// corrected on screen is the one that gets written.
    /// </summary>
    public class CustomerLedgerCommitDto
    {
        public int CompanyId { get; set; }
        public int? ImportProfileId { get; set; }
        public int? ProfileVersion { get; set; }

        public string FileSha256 { get; set; } = "";
        public string FileName { get; set; } = "";
        public long FileSizeBytes { get; set; }

        public DateTime OpeningDate { get; set; }
        public DateTime PeriodEnd { get; set; }

        /// <summary>
        /// Freeze the general ledger at <see cref="PeriodEnd"/> and load the
        /// receivable total as the AR account's opening balance. Default true:
        /// without it the GL cannot be enabled later without double-counting the
        /// imported documents.
        /// </summary>
        public bool SetGlCutover { get; set; } = true;

        public List<LedgerClientPreviewDto> Clients { get; set; } = new();
        public List<LedgerInvoiceDto> Invoices { get; set; } = new();
        public List<LedgerReceiptDto> Receipts { get; set; } = new();
    }

    public class CustomerLedgerCommitResultDto
    {
        public int ImportRunId { get; set; }
        public int ClientsCreated { get; set; }
        public int ClientsReused { get; set; }
        public int InvoicesCreated { get; set; }
        public int ReceiptsCreated { get; set; }
        public decimal TotalReceivable { get; set; }
        public DateTime? GlLockDate { get; set; }
        public List<string> Messages { get; set; } = new();
    }
}
