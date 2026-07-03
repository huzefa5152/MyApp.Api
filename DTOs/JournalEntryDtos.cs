namespace MyApp.Api.DTOs
{
    /// <summary>One Dr/Cr line of a journal entry, with its account resolved
    /// for display. Exactly one of Debit/Credit is non-zero.</summary>
    public class JournalLineDto
    {
        public int Id { get; set; }
        public int AccountId { get; set; }
        public string AccountName { get; set; } = "";
        public string? AccountCode { get; set; }
        public decimal Debit { get; set; }
        public decimal Credit { get; set; }
        public string? Description { get; set; }
    }

    /// <summary>Read shape for a general-ledger journal entry — covers both
    /// system-posted entries (SourceDocType names the source document) and
    /// operator-authored manual journals (IsManual). SourceDocType travels as
    /// the enum NAME string, matching the codebase's string-status convention.</summary>
    public class JournalEntryDto
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public int EntryNo { get; set; }
        /// <summary>Display reference: "JE-####".</summary>
        public string Reference { get; set; } = "";
        public DateTime Date { get; set; }
        public string? Narration { get; set; }

        /// <summary>"ManualJournal" | "Invoice" | "PurchaseBill" | "Payment" | "AccountTransfer".</summary>
        public string SourceDocType { get; set; } = "ManualJournal";
        public int? SourceDocId { get; set; }

        /// <summary>Optional Division tag and its resolved name.</summary>
        public int? DivisionId { get; set; }
        public string? DivisionName { get; set; }

        public decimal TotalDebit { get; set; }
        public decimal TotalCredit { get; set; }

        public List<JournalLineDto> Lines { get; set; } = new();

        public DateTime CreatedAt { get; set; }

        /// <summary>True for operator-authored entries (editable); system-posted
        /// entries are maintained by the posting engine and are read-only here.</summary>
        public bool IsManual { get; set; }
    }

    /// <summary>Create/update shape for one manual journal line. Exactly one of
    /// Debit/Credit must be &gt; 0 (the other 0); negatives are rejected.</summary>
    public class CreateJournalLineDto
    {
        public int AccountId { get; set; }
        public decimal Debit { get; set; }
        public decimal Credit { get; set; }
        public string? Description { get; set; }
    }

    /// <summary>Create/update shape for a manual journal entry. Needs ≥ 2 lines
    /// and Σ Debit == Σ Credit &gt; 0. EntryNo is allocated server-side (create)
    /// and preserved on update.</summary>
    public class CreateJournalEntryDto
    {
        public DateTime Date { get; set; }
        public string? Narration { get; set; }

        /// <summary>Optional Division tag (validated against the company server-side).</summary>
        public int? DivisionId { get; set; }

        public List<CreateJournalLineDto> Lines { get; set; } = new();
    }
}
