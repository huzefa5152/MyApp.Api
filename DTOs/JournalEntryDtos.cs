namespace MyApp.Api.DTOs
{
    /// <summary>One Dr/Cr line of a journal entry with its account resolved for
    /// display. Exactly one of Debit/Credit is non-zero.</summary>
    public class JournalLineDto
    {
        public int Id { get; set; }
        public int AccountId { get; set; }
        public string AccountName { get; set; } = "";
        public string? AccountCode { get; set; }
        public decimal Debit { get; set; }
        public decimal Credit { get; set; }
        public string? Description { get; set; }

        // ── Subledger attribution ──
        // Which party and which document the line belongs to, when it has one.
        // A control-account line (Accounts receivable / payable) always names
        // its party, so a reader sees whose balance moved without opening the
        // source document, and the ledger view can group by party.

        /// <summary>"Client" | "Supplier", or null for a line with no party.</summary>
        public string? PartyType { get; set; }
        public int? PartyId { get; set; }
        public int? InvoiceId { get; set; }
        public int? PurchaseBillId { get; set; }
    }

    /// <summary>Read shape for a general-ledger entry — both system-posted
    /// entries (SourceDocType names the source document) and operator-authored
    /// manual journals (IsManual). SourceDocType travels as the enum NAME,
    /// matching the codebase's string-status convention.</summary>
    public class JournalEntryDto
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public int EntryNo { get; set; }

        /// <summary>Display reference: "JE-####".</summary>
        public string Reference { get; set; } = "";

        public DateTime Date { get; set; }
        public string? Narration { get; set; }

        /// <summary>"ManualJournal" | "Invoice" | "PurchaseBill" | "Payment" |
        /// "AccountTransfer" | "PurchaseDebitNote".</summary>
        public string SourceDocType { get; set; } = "ManualJournal";
        public int? SourceDocId { get; set; }

        public decimal TotalDebit { get; set; }
        public decimal TotalCredit { get; set; }

        public List<JournalLineDto> Lines { get; set; } = new();

        public DateTime CreatedAt { get; set; }

        /// <summary>True for operator-authored entries, which are editable here.
        /// A system-posted entry belongs to the posting engine and is read-only
        /// on this screen — it changes when its source document changes.</summary>
        public bool IsManual { get; set; }

        /// <summary>False when the entry's date falls in a closed period, so the
        /// UI can show it without offering edit or delete.</summary>
        public bool IsLocked { get; set; }
    }

    /// <summary>Create/update shape for one manual journal line. Exactly one of
    /// Debit/Credit must be &gt; 0 and the other 0; negatives are refused.</summary>
    public class CreateJournalLineDto
    {
        public int AccountId { get; set; }
        public decimal Debit { get; set; }
        public decimal Credit { get; set; }
        public string? Description { get; set; }
    }

    /// <summary>Create/update shape for a manual journal. Needs at least two
    /// lines and SUM(Debit) == SUM(Credit) &gt; 0. EntryNo is allocated
    /// server-side on create and preserved on update.</summary>
    public class CreateJournalEntryDto
    {
        public DateTime Date { get; set; }
        public string? Narration { get; set; }
        public List<CreateJournalLineDto> Lines { get; set; } = new();
    }
}
