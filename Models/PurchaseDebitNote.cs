using MyApp.Api.Models.Accounting;

namespace MyApp.Api.Models
{
    /// <summary>
    /// A PURCHASE (supplier-side) debit note — the buyer debits a
    /// <see cref="Supplier"/> (e.g. goods returned / an over-charge), reducing
    /// what the company owes them. This is the mirror of a sales Credit/Debit
    /// Note (which live on <see cref="Invoice"/> against a Client): those are
    /// customer-side, this is supplier-side. Kept as a lean, standalone
    /// document — it records the note and its lines so it can be listed and
    /// printed. It carries no stock movement and posts no GL of its own; when a
    /// business is migrated its financial effect is already captured by the
    /// chart-of-accounts opening balances / GL true-up.
    /// </summary>
    public class PurchaseDebitNote
    {
        public int Id { get; set; }
        public int DebitNoteNumber { get; set; }
        public DateTime Date { get; set; }
        public int CompanyId { get; set; }
        /// <summary>Optional division ("sub-company"); when set the note numbers
        /// from the division's own sequence. Null = company-level.</summary>
        public int? DivisionId { get; set; }
        public int SupplierId { get; set; }

        /// <summary>The supplier's own reference on their document (free text).</summary>
        public string? SupplierRef { get; set; }
        public string? Notes { get; set; }

        public decimal Subtotal { get; set; }
        /// <summary>Header GST rate (%). User-created notes capture this and the
        /// service computes <see cref="GSTAmount"/>; the import leaves both 0.</summary>
        public decimal GSTRate { get; set; }
        public decimal GSTAmount { get; set; }
        public decimal GrandTotal { get; set; }

        /// <summary>True when brought in by the Manager.io / legacy migration.
        /// ExternalRef carries "mgr-pdn:{guid}" for idempotency.</summary>
        public bool IsMigrated { get; set; }
        public string? ExternalRef { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Navigation
        public Company Company { get; set; } = null!;
        public Division? Division { get; set; }
        public Supplier Supplier { get; set; } = null!;
        public ICollection<PurchaseDebitNoteItem> Items { get; set; } = new List<PurchaseDebitNoteItem>();
    }

    /// <summary>One line of a <see cref="PurchaseDebitNote"/>.</summary>
    public class PurchaseDebitNoteItem
    {
        public int Id { get; set; }
        public int PurchaseDebitNoteId { get; set; }
        public string Description { get; set; } = "";
        public decimal Quantity { get; set; }
        public string? UOM { get; set; }
        public decimal UnitPrice { get; set; }
        public decimal LineTotal { get; set; }

        /// <summary>Optional inventory classification. When set (and the company
        /// tracks that item type), the line records a stock OUT — the goods
        /// returned to the supplier reduce on-hand. Migration-created rows leave
        /// it null → no stock movement, exactly as today.</summary>
        public int? ItemTypeId { get; set; }
        /// <summary>Denormalized item-type name at save time (mirrors PurchaseItem).</summary>
        public string? ItemTypeName { get; set; }
        /// <summary>Optional per-line GL account override; else the account is
        /// resolved from the item type / company default at posting time.</summary>
        public int? AccountId { get; set; }
        /// <summary>Optional FBR HS code carried from the item type (metadata).</summary>
        public string? HSCode { get; set; }

        // Navigation
        public PurchaseDebitNote PurchaseDebitNote { get; set; } = null!;
        public ItemType? ItemType { get; set; }
        public Account? Account { get; set; }
    }
}
