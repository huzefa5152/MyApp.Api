namespace MyApp.Api.Models
{
    /// <summary>
    /// Logical grouping layer that lets the same legal entity (a "Common
    /// Client") show up under multiple companies WITHOUT changing the
    /// per-company ownership of the actual <see cref="Client"/> rows.
    ///
    /// Why a table at all (vs. computing groups on the fly)?
    ///   • <see cref="POFormat.ClientGroupId"/> needs a stable FK so a PO
    ///     format configured against "Meko Denim Mills" applies the moment
    ///     ANY company encounters a Meko-format PO, no matter which tenant
    ///     issues it.
    ///   • Update-propagation ("edit common client → update all sibling
    ///     rows") becomes a simple FK join instead of repeating the
    ///     normalisation logic across every endpoint.
    ///
    /// Identity is determined by <see cref="GroupKey"/> — NTN wins, falling
    /// back to a normalised name. ComputeGroupKey() in the service is the
    /// single source of truth; this row just stores the result so that FK
    /// references can point at it.
    /// </summary>
    public class ClientGroup
    {
        public int Id { get; set; }

        /// <summary>
        /// Canonical, deduplicated identifier for the legal entity.
        ///   • "NTN:&lt;digits-only&gt;"   — when the client has a valid NTN
        ///                                    (≥7 digits after stripping
        ///                                    non-digits). Same digits =
        ///                                    same legal entity, irrespective
        ///                                    of tiny name spelling differences.
        ///   • "NAME:&lt;lower-trimmed&gt;" — fallback when no NTN is set.
        ///                                    Operators on different tenants
        ///                                    typing the same name get auto-
        ///                                    linked; case + whitespace
        ///                                    differences are normalised away.
        /// Unique across the whole table.
        /// </summary>
        public string GroupKey { get; set; } = "";

        /// <summary>
        /// Best human-readable label for this group — usually the most-common
        /// Name across the member <see cref="Client"/> rows. Operator-edited
        /// from the Common Client form; cascades nothing on its own (the
        /// per-Client Name fields cascade via the update API).
        /// </summary>
        public string DisplayName { get; set; } = "";

        /// <summary>
        /// Digits-only NTN (or null when the group is name-based). Indexed
        /// for the "find me the group for this NTN" lookup we hit on every
        /// Client save and PO match.
        /// </summary>
        public string? NormalizedNtn { get; set; }

        /// <summary>
        /// Lowercased + trimmed + whitespace-collapsed name. Indexed for the
        /// fallback name match when NTN is missing.
        /// </summary>
        public string NormalizedName { get; set; } = "";

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

        // Navigation: every Client row points to AT MOST one group. A group
        // with one member is a "single-company" group — kept so the moment
        // another tenant adds the same NTN/name they auto-link without a
        // rebuild. The "Common Clients" UI hides single-member groups via
        // a server-side HAVING COUNT(DISTINCT CompanyId) >= 2 filter.
        public ICollection<Client> Clients { get; set; } = new List<Client>();

        // Navigation: PO formats that should apply to ALL members of the
        // group, regardless of which tenant the PDF arrives from. Kept
        // alongside POFormat.ClientId for backward compatibility — legacy
        // formats with only ClientId still work via the existing match path.
        public ICollection<POFormat> POFormats { get; set; } = new List<POFormat>();
    }
}
