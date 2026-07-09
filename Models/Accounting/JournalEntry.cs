namespace MyApp.Api.Models.Accounting
{
    /// <summary>Which document produced a journal entry. ManualJournal = an
    /// operator-authored entry (the Journal Entries module); everything else is
    /// system-posted from its source document and is replaced wholesale when
    /// that document changes (replace-on-edit — the ledger always mirrors the
    /// current document state, the way the reference product recomputes).</summary>
    public enum SourceDocType
    {
        ManualJournal = 0,
        Invoice = 1,          // sales invoice, credit note (DocumentType 10), debit note (9)
        PurchaseBill = 2,
        Payment = 3,          // receipt (money in) or payment (money out)
        AccountTransfer = 4,
    }

    /// <summary>
    /// One balanced general-ledger entry (design §11.1 / Phase B). Header only —
    /// the Dr/Cr detail lives in <see cref="JournalLine"/>s. Idempotency: at most
    /// one entry per (CompanyId, SourceDocType, SourceDocId), enforced by a
    /// filtered unique index; posting a document again replaces its entry inside
    /// the caller's transaction. Manual entries have SourceDocId = null and are
    /// exempt from that uniqueness.
    /// </summary>
    public class JournalEntry
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }

        /// <summary>Sequence unique per company (JE-####). Allocated max+1 under
        /// NumberAllocationRetry, same pattern as document numbers.</summary>
        public int EntryNo { get; set; }

        public DateTime Date { get; set; }
        public string? Narration { get; set; }

        public SourceDocType SourceDocType { get; set; }

        /// <summary>Id of the source document (Payment/Invoice/PurchaseBill/
        /// AccountTransfer). Null for manual journals.</summary>
        public int? SourceDocId { get; set; }

        /// <summary>Optional reporting tag copied from the source document.</summary>
        public int? DivisionId { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Navigation
        public Company Company { get; set; } = null!;
        public ICollection<JournalLine> Lines { get; set; } = new List<JournalLine>();
    }

    /// <summary>
    /// One Dr/Cr line of a <see cref="JournalEntry"/>. Exactly one side is
    /// non-zero (both stored ≥ 0, decimal(19,4) GL precision). Party/document
    /// columns carry the AR/AP subledger dimension (which customer, which
    /// invoice) so statements and control-account drill-downs can be built —
    /// they are soft references (no FK) so existing document delete paths keep
    /// working; the posting engine removes entries when their source dies.
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

        /// <summary>Settled/created document for AR/AP lines (soft refs).</summary>
        public int? InvoiceId { get; set; }
        public int? PurchaseBillId { get; set; }

        public string? Description { get; set; }
        public int? DivisionId { get; set; }

        // Navigation
        public JournalEntry JournalEntry { get; set; } = null!;
        public Account Account { get; set; } = null!;
    }
}
