using MyApp.Api.Models.Accounting;

namespace MyApp.Api.Models
{
    /// <summary>
    /// Per-company inventory tracking policy version.
    ///
    /// V1 (legacy, default for every existing company): ONLY item types with a
    /// non-empty HSCode are stock-tracked — the behaviour shipped before the
    /// 2026-07 inventory redesign. Kept byte-identical so the two live tenants
    /// and the pinned <c>test_stock_itemtype_reflow.py</c> suite are untouched
    /// until a company deliberately opts in.
    ///
    /// V2 (redesigned lifecycle): ALL non-deleted item types are inventory
    /// items; the HS code is FBR-reporting metadata only, not a tracking
    /// discriminator. Individual items can be opted out per company via a
    /// <see cref="CompanyItemTypeSetting"/> row with Mode = FbrOnly.
    ///
    /// Stored as a plain byte on <see cref="Company"/> (mirrors DocumentType /
    /// NoteKind) so migrations and raw SQL stay trivial.
    /// </summary>
    public enum InventoryFlowVersion : byte
    {
        V1Legacy = 1,
        V2Standard = 2,
    }

    /// <summary>
    /// Per-company override of an item type's inventory participation.
    /// Needed because <see cref="ItemType"/> is a GLOBAL catalog (no
    /// CompanyId), so tracking policy cannot live on the item itself without
    /// leaking semantics across tenants. Absence of a row = follow the
    /// company's <see cref="InventoryFlowVersion"/> default.
    /// </summary>
    public enum InventoryItemMode : byte
    {
        /// <summary>Follow the company's flow-version default.</summary>
        Default = 0,

        /// <summary>
        /// Force-track this item as inventory regardless of the default
        /// (e.g. a V1 company that wants a no-HS item tracked, or the
        /// "HS-coded item that IS real inventory" case under V2).
        /// </summary>
        Tracked = 1,

        /// <summary>
        /// Exclude this item from inventory entirely — FBR-reporting
        /// metadata only. The V2 opt-out (e.g. FBR-import auto-created
        /// HS rows that must not move stock until explicitly mapped).
        /// </summary>
        FbrOnly = 2,
    }

    /// <summary>
    /// Per-(company, item-type) overlay — the company's own "registration" of a
    /// row from the GLOBAL <see cref="ItemType"/> catalog. Carries the tracking-
    /// mode override, an optional reorder level, an optional division scope, and
    /// the company's own GL account mapping for lines using this item type.
    /// One row at most per (CompanyId, ItemTypeId) pair (unique index in
    /// AppDbContext) — <see cref="DivisionId"/> is a scope TAG, not part of the
    /// key, so the inventory-tracking lookups keyed on ItemTypeId stay 1:1.
    /// </summary>
    public class CompanyItemTypeSetting
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public int ItemTypeId { get; set; }

        /// <summary>
        /// Optional division scope (2026-07-14). Null = a company-wide item type
        /// (available to every division). Set = this item type "belongs to" the
        /// named division — document pickers filtered by division show it only
        /// for that division (plus the company-wide ones). Lets both a company
        /// and a division curate their own inventory types. FK → Division
        /// (NoAction: Division already cascades from Company, a second cascade
        /// path would trip SQL Server 1785).
        /// </summary>
        public int? DivisionId { get; set; }

        public InventoryItemMode Mode { get; set; } = InventoryItemMode.Default;

        /// <summary>Optional reorder threshold surfaced as a low-stock badge
        /// on the inventory summary. Null = no reorder tracking.</summary>
        public decimal? ReorderLevel { get; set; }

        /// <summary>
        /// Income account a SALES line using this item type posts to, for THIS
        /// company (Manager's per-item "Custom income account"). Null = fall back
        /// to <see cref="Company.DefaultSalesAccountId"/>, then the engine's
        /// name-guess chain. FK → Account (NoAction — two account FKs from one
        /// table trip SQL Server's multiple-cascade-path guard 1785).
        /// </summary>
        public int? SaleAccountId { get; set; }

        /// <summary>Expense/COGS account a PURCHASE line using this item type
        /// posts to, for THIS company. Null = <see cref="Company.DefaultPurchaseAccountId"/>
        /// then the engine's chain.</summary>
        public int? PurchaseAccountId { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

        // Navigation
        public Company Company { get; set; } = null!;
        public ItemType ItemType { get; set; } = null!;
        public Division? Division { get; set; }
        public Account? SaleAccount { get; set; }
        public Account? PurchaseAccount { get; set; }
    }
}
