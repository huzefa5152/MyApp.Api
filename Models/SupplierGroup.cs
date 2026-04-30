namespace MyApp.Api.Models
{
    /// <summary>
    /// Mirror of <see cref="ClientGroup"/> for the purchase side. Lets the
    /// same legal entity (a "Common Supplier") show up under multiple
    /// companies without changing the per-company ownership of the
    /// actual <see cref="Supplier"/> rows.
    ///
    /// Same identity rules as ClientGroup: NTN wins (digits-only ≥ 7),
    /// fallback to a normalised name. Single-member groups are kept so
    /// the moment a 2nd company adds the same supplier, EnsureGroup
    /// links them automatically without needing a rebuild.
    /// </summary>
    public class SupplierGroup
    {
        public int Id { get; set; }

        /// <summary>
        /// Canonical identifier — "NTN:&lt;digits&gt;" or "NAME:&lt;lower-trimmed&gt;".
        /// Unique across the whole table; the service is the single
        /// writer and finds-or-creates by this value.
        /// </summary>
        public string GroupKey { get; set; } = "";

        /// <summary>
        /// Best human-readable label — typically the most-recently-saved
        /// Name across the member <see cref="Supplier"/> rows.
        /// </summary>
        public string DisplayName { get; set; } = "";

        /// <summary>Digits-only NTN (or null when the group is name-based).</summary>
        public string? NormalizedNtn { get; set; }

        /// <summary>Lowercased + trimmed + whitespace-collapsed name.</summary>
        public string NormalizedName { get; set; } = "";

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

        // Navigation: every Supplier row points to AT MOST one group.
        public ICollection<Supplier> Suppliers { get; set; } = new List<Supplier>();
    }
}
