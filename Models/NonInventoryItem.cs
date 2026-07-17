using MyApp.Api.Models.Accounting;

namespace MyApp.Api.Models
{
    /// <summary>
    /// A per-company "Non-Inventory Item" — a named shortcut to a GL income /
    /// expense account, with NO stock and NO FBR classification. Mirrors
    /// Manager.io's <i>Non-inventory Items</i> (as opposed to <i>Inventory
    /// Items</i>, which are the stock-tracked products modelled by
    /// <see cref="ItemType"/>). Typical uses: Freight Charges, Discount,
    /// service fees — line items that move money onto a specific account but
    /// never touch inventory.
    ///
    /// This is deliberately a SEPARATE entity from <see cref="ItemType"/>:
    ///   • <see cref="ItemType"/> is a GLOBAL product catalog (HS code, UOM,
    ///     FBR sale type, inventory tracking).
    ///   • <see cref="NonInventoryItem"/> is PER-COMPANY, because its whole
    ///     job is mapping to that company's own chart of accounts (each
    ///     company's <see cref="Account"/> rows differ).
    ///
    /// A document line references AT MOST ONE of: an <see cref="ItemType"/>
    /// (product / inventory / FBR behaviour), a <see cref="NonInventoryItem"/>
    /// (posts to its mapped account, moves no stock), or neither (free text).
    /// The both-set guard lives in <c>AppDbContext</c> / the line services.
    /// </summary>
    public class NonInventoryItem
    {
        public int Id { get; set; }

        /// <summary>Per-company scope (FK → Company, Restrict). Unlike the
        /// global <see cref="ItemType"/>, this entity is company-scoped because
        /// its account mappings point at that company's chart of accounts.</summary>
        public int CompanyId { get; set; }

        /// <summary>Display name, e.g. "Freight Charges". Unique per company.</summary>
        public string Name { get; set; } = "";

        /// <summary>Optional short code (Manager parity).</summary>
        public string? Code { get; set; }

        /// <summary>Optional unit label (UOM), prefilled onto the line.</summary>
        public string? UnitName { get; set; }

        /// <summary>"When sold → Account": the income account a SALES line using
        /// this item posts to. Nullable → falls back to Suspense at posting.</summary>
        public int? SaleAccountId { get; set; }

        /// <summary>"When purchased → Account": the expense/asset account a
        /// PURCHASE line using this item posts to. Nullable → Suspense.</summary>
        public int? PurchaseAccountId { get; set; }

        /// <summary>Optional narration prefilled onto the line description.</summary>
        public string? DefaultLineDescription { get; set; }

        /// <summary>Optional autofill unit prices (Manager parity).</summary>
        public decimal? DefaultSalePrice { get; set; }
        public decimal? DefaultPurchasePrice { get; set; }

        /// <summary>"Hide item name on printed documents" (Manager parity).</summary>
        public bool HideNameOnPrint { get; set; }

        /// <summary>Soft-disable — hidden from pickers, historical lines keep working.</summary>
        public bool IsActive { get; set; } = true;

        /// <summary>Source-system key for idempotent imports
        /// (<c>mgr-niitem:{managerGuid}</c>). Null for hand-created rows.</summary>
        public string? ExternalRef { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Navigation
        public Company Company { get; set; } = null!;
        public Account? SaleAccount { get; set; }
        public Account? PurchaseAccount { get; set; }
    }
}
