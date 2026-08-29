namespace MyApp.Api.Models
{
    /// <summary>
    /// Master HS / PCT code reference data — the app's OWN copy of Pakistan
    /// Customs' tariff codes, kept independently of any company's FBR
    /// integration.
    ///
    /// WHY A LOCAL MASTER (2026-08-30). Before this table the only source of
    /// HS codes was a live PRAL call (<c>/pdi/v1/itemdesccode</c>) authorised
    /// with the *requesting company's* FBR token, cached in-process. A company
    /// with FBR integration off — or simply mid-onboarding without a token —
    /// therefore had an empty HS Code picker and could not classify its item
    /// types at all. Reference data is not tenant data: the tariff is the same
    /// for everyone, so it belongs in a shared table that survives restarts and
    /// is readable with no FBR credentials whatsoever.
    ///
    /// The chain is deliberately one-directional:
    ///     HsCode (master) → ItemType → company documents → FBR submission (optional)
    /// Nothing here depends on <see cref="Company.FbrEnabled"/>; that flag only
    /// controls whether invoices are actually submitted to FBR.
    ///
    /// Rows are refreshed by the "Import HS Codes" action, which upserts on
    /// <see cref="Code"/> — an existing code keeps its row (and therefore its
    /// ItemType links), a new code is inserted. Running it repeatedly is safe.
    /// </summary>
    public class HsCode
    {
        public int Id { get; set; }

        /// <summary>
        /// The PCT / HS code exactly as FBR publishes it, e.g. "6109.1000".
        /// Unique (case-insensitive by the DB's default collation) — the
        /// import's idempotency hinges on this.
        /// </summary>
        public string Code { get; set; } = "";

        /// <summary>FBR's description of the code ("T-shirts, singlets ... of cotton").</summary>
        public string? Description { get; set; }

        /// <summary>
        /// Applicable UOM description for this code (e.g. "Numbers, pieces, units"),
        /// when known. FBR publishes UOMs per HS code through a SEPARATE endpoint
        /// (<c>/pdi/v2/HS_UOM</c>) that takes one code per call, so the bulk import
        /// cannot fill 14k of them. It is populated lazily the first time someone
        /// asks for this code's UOMs, and by any import that can resolve it.
        /// </summary>
        public string? Uom { get; set; }

        /// <summary>FBR's numeric UOM id matching <see cref="Uom"/>, when known.</summary>
        public int? FbrUomId { get; set; }

        /// <summary>
        /// Local <see cref="Unit"/> row matching <see cref="Uom"/>, when one exists.
        /// The Units admin page owns decimal-quantity policy per unit, so linking
        /// here keeps the HS master consistent with the rest of the app's UOMs.
        /// </summary>
        public int? UnitId { get; set; }

        /// <summary>
        /// False hides the code from pickers without deleting it — FBR retires
        /// codes between tariff years and historical documents still reference them.
        /// </summary>
        public bool IsActive { get; set; } = true;

        /// <summary>Where the row came from: "FBR" (imported) or "Manual".</summary>
        public string Source { get; set; } = "FBR";

        /// <summary>Last time an import confirmed this code still exists upstream.</summary>
        public DateTime? LastSyncedAt { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

        // Navigation
        public Unit? Unit { get; set; }
    }
}
