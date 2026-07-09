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
    /// Per-(company, item-type) inventory settings. Carries the tracking-mode
    /// override and an optional reorder level for the inventory summary.
    /// One row at most per pair (unique index in AppDbContext).
    /// </summary>
    public class CompanyItemTypeSetting
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public int ItemTypeId { get; set; }

        public InventoryItemMode Mode { get; set; } = InventoryItemMode.Default;

        /// <summary>Optional reorder threshold surfaced as a low-stock badge
        /// on the inventory summary. Null = no reorder tracking.</summary>
        public decimal? ReorderLevel { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

        // Navigation
        public Company Company { get; set; } = null!;
        public ItemType ItemType { get; set; } = null!;
    }
}
