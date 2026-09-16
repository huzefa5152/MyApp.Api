namespace MyApp.Api.Models.Accounting
{
    /// <summary>
    /// Which document produced a journal entry. <c>ManualJournal</c> is an
    /// operator-authored entry from the Journal Entries screen; everything else
    /// is system-posted from its source document and is replaced wholesale when
    /// that document changes, so the ledger always mirrors the document's
    /// current state rather than accumulating corrections.
    ///
    /// Like <see cref="ControlType"/>, the NUMBERING is shared with the other
    /// production lines and a number is never reused for a different meaning —
    /// a <c>JournalEntries.SourceDocType</c> value is how an entry remembers
    /// what made it. 6 (ImportConsignment) is reserved for the importer line's
    /// customs-GD costing and is not declared here, because this line has no
    /// such document.
    /// </summary>
    public enum SourceDocType
    {
        ManualJournal = 0,
        Invoice = 1,           // sales invoice, credit note, debit note
        PurchaseBill = 2,
        Payment = 3,           // receipt (money in) or payment (money out)
        AccountTransfer = 4,
        PurchaseDebitNote = 5, // supplier debit note
        // 6 ImportConsignment — reserved, see the type remarks.
    }

    /// <summary>
    /// One balanced general-ledger entry. Header only — the Dr/Cr detail lives
    /// in <see cref="JournalLine"/>s.
    ///
    /// Idempotency: at most one entry per
    /// (CompanyId, SourceDocType, SourceDocId), enforced by a filtered unique
    /// index, so posting a document twice replaces its entry instead of
    /// doubling the books. Manual journals have <see cref="SourceDocId"/> null
    /// and are exempt from that uniqueness — an operator may write as many as
    /// they like.
    /// </summary>
    public class JournalEntry
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }

        /// <summary>Sequence unique per company, displayed JE-####. Allocated
        /// max+1 under <c>NumberAllocationRetry</c>, the same way document
        /// numbers are, so two concurrent creates can't collide.</summary>
        public int EntryNo { get; set; }

        public DateTime Date { get; set; }
        public string? Narration { get; set; }

        public SourceDocType SourceDocType { get; set; }

        /// <summary>Id of the source document. Null for manual journals.</summary>
        public int? SourceDocId { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Navigation
        public Company Company { get; set; } = null!;
        public ICollection<JournalLine> Lines { get; set; } = new List<JournalLine>();
    }

    /// <summary>
    /// One Dr/Cr line of a <see cref="JournalEntry"/>. Exactly one side is
    /// non-zero and both are stored as non-negative decimal(19,4), so a line
    /// never has to be read as "a negative debit".
    ///
    /// The party and document columns carry the AR/AP subledger dimension —
    /// which customer, which invoice — so statements and control-account
    /// drill-downs can be built without re-deriving them from the documents.
    /// They are SOFT references with no foreign key: the existing document
    /// delete paths must keep working untouched, and the posting engine removes
    /// an entry when its source dies.
    /// </summary>
    public class JournalLine
    {
        public int Id { get; set; }
        public int JournalEntryId { get; set; }
        public int AccountId { get; set; }

        public decimal Debit { get; set; }
        public decimal Credit { get; set; }

        /// <summary>"Client" | "Supplier" | null — the subledger party.</summary>
        public string? PartyType { get; set; }
        public int? PartyId { get; set; }

        /// <summary>The document this line settles or creates (soft refs).</summary>
        public int? InvoiceId { get; set; }
        public int? PurchaseBillId { get; set; }

        public string? Description { get; set; }

        // Navigation
        public JournalEntry JournalEntry { get; set; } = null!;
        public Account Account { get; set; } = null!;
    }
}
