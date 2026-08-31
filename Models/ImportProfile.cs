namespace MyApp.Api.Models
{
    /// <summary>
    /// Which importer consumes a profile. The mapping schema differs per kind,
    /// so the value picks both the reader and the validator for
    /// <see cref="ImportProfile.MappingJson"/>.
    /// </summary>
    public static class ImportKinds
    {
        public const string OpeningStock = "OpeningStock";
        public const string CustomerLedger = "CustomerLedger";

        public static readonly string[] All = { OpeningStock, CustomerLedger };

        public static bool IsValid(string? kind) =>
            !string.IsNullOrWhiteSpace(kind)
            && All.Contains(kind, StringComparer.OrdinalIgnoreCase);

        /// <summary>Canonical casing for a caller-supplied kind, or null when
        /// unknown. Callers compare against the constants, so a request that
        /// says "openingstock" must not silently miss.</summary>
        public static string? Canonical(string? kind) =>
            All.FirstOrDefault(k => string.Equals(k, kind?.Trim(), StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// Structural readers registered per kind. A layout says HOW the workbook is
    /// arranged; the profile's mapping then says WHERE each field sits within
    /// that arrangement. Column mapping alone cannot express "one sheet per
    /// customer with the name in A3", which is why this is a separate axis.
    /// </summary>
    public static class ImportLayouts
    {
        /// <summary>Stock rows are customs lots — one item can appear on several
        /// declarations and the quantities sum.</summary>
        public const string LotRows = "LotRows";

        /// <summary>An index sheet naming every customer, then one sheet per
        /// customer carrying that customer's transactions.</summary>
        public const string IndexPlusPerClientSheets = "IndexPlusPerClientSheets";

        public static readonly IReadOnlyDictionary<string, string[]> ByKind =
            new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase)
            {
                [ImportKinds.OpeningStock] = new[] { LotRows },
                [ImportKinds.CustomerLedger] = new[] { IndexPlusPerClientSheets },
            };

        public static bool IsValidFor(string kind, string? layout) =>
            ByKind.TryGetValue(kind ?? "", out var allowed)
            && layout != null
            && allowed.Contains(layout, StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>
    /// A recognisable spreadsheet layout that an operator has confirmed once and
    /// the importer can then reuse. Every uploaded workbook is fingerprinted and
    /// matched against this table — a hit skips the mapping step entirely and
    /// goes straight to preview.
    ///
    /// Deliberately shaped like <see cref="POFormat"/>, which solves the same
    /// problem for PO PDFs: fingerprint → stored rule-set → deterministic parse,
    /// with an append-only version history so a mapping change can be rolled
    /// back. Nothing here is specific to any one company's workbook.
    /// </summary>
    public class ImportProfile
    {
        public int Id { get; set; }

        /// <summary>One of <see cref="ImportKinds"/>.</summary>
        public string Kind { get; set; } = "";

        /// <summary>One of <see cref="ImportLayouts"/>, valid for
        /// <see cref="Kind"/>. Checked at save time, because an unknown layout
        /// would only surface as a null strategy at import time.</summary>
        public string Layout { get; set; } = "";

        /// <summary>Operator-facing label, e.g. "Alpha Traders customer ledger".</summary>
        public string Name { get; set; } = "";

        /// <summary>
        /// Null = an installation-wide reference layout any company may use;
        /// set = private to that tenant. Mirrors <see cref="POFormat.CompanyId"/>.
        /// Several tenants often share one accountant's template, so the shared
        /// case has to be expressible — but only the seed admin can create it,
        /// since a shared profile is visible to every company.
        /// </summary>
        public int? CompanyId { get; set; }
        public Company? Company { get; set; }

        /// <summary>SHA-256 (hex, lower-case) of the normalised workbook
        /// signature. Exact match is the primary routing mechanism.</summary>
        public string SignatureHash { get; set; } = "";

        /// <summary>Pipe-delimited sorted signature tokens. Kept on the row so a
        /// near-match can be scored by Jaccard similarity without re-reading the
        /// workbook that produced it.</summary>
        public string TokenSignature { get; set; } = "";

        /// <summary>The frozen mapping the layout strategy consumes. JSON rather
        /// than columns so the schema can evolve without a migration per field —
        /// same reasoning as <see cref="POFormat.RuleSetJson"/>.</summary>
        public string MappingJson { get; set; } = "{}";

        /// <summary>Monotonic; bumped whenever <see cref="MappingJson"/> changes.
        /// Every revision is kept in <see cref="ImportProfileVersion"/>.</summary>
        public int CurrentVersion { get; set; } = 1;

        /// <summary>Soft-disable so a misbehaving profile leaves the matching
        /// pool without losing the history of what it used to do.</summary>
        public bool IsActive { get; set; } = true;

        public string? Notes { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }
}
