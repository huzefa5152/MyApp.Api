namespace MyApp.Api.DTOs
{
    /// <summary>One row of the local HS / PCT master, as the pickers see it.</summary>
    public class HsCodeDto
    {
        public int Id { get; set; }
        public string Code { get; set; } = "";
        public string? Description { get; set; }
        public string? Uom { get; set; }
        public int? FbrUomId { get; set; }
        public bool IsActive { get; set; }
        public string Source { get; set; } = "FBR";
        public DateTime? LastSyncedAt { get; set; }

        /// <summary>
        /// Id of the Item Type already mapped to this code, when there is one.
        /// The Item Type form uses it to warn "this code is already mapped to
        /// X" instead of silently creating a second row.
        /// </summary>
        public int? ItemTypeId { get; set; }
        public string? ItemTypeName { get; set; }
    }

    /// <summary>Body of POST /api/hscodes/import.</summary>
    public class HsCodeImportRequestDto
    {
        /// <summary>
        /// Optional company whose own FBR token may be used when the
        /// installation-wide reference token is not configured. Access is
        /// asserted against the caller. FBR integration does NOT have to be
        /// enabled on it — only a token has to exist.
        /// </summary>
        public int? CompanyId { get; set; }

        /// <summary>
        /// Create a placeholder Item Type for every imported code that has none
        /// (requirement 4). Auto-created rows are non-favourite so the curated
        /// bill/challan pickers stay usable; the operator renames them later.
        /// </summary>
        public bool CreateItemTypes { get; set; } = true;
    }

    /// <summary>The summary shown to the operator after an import.</summary>
    /// <summary>
    /// Outcome of filling in the UOM on master rows that have none.
    ///
    /// FBR publishes units through a per-code endpoint, one call per code, so
    /// this walks the master rather than pulling a list. It exists because the
    /// published customs tariff carries no unit column at all: without it every
    /// imported code starts unit-less, and the Item Type form cannot pre-fill.
    /// </summary>
    public class HsUomBackfillRequestDto
    {
        /// <summary>Optional: fall back to this company's own FBR token when the
        /// installation has no reference token. Never another tenant's.</summary>
        public int? CompanyId { get; set; }

        /// <summary>Codes to look up in this call. Server-clamped.</summary>
        public int Max { get; set; } = 100;

        /// <summary>Only codes an item type already references — a few dozen
        /// rather than thousands, and the ones that actually matter.</summary>
        public bool OnlyInUse { get; set; } = true;
    }

    public class HsUomBackfillResultDto
    {
        /// <summary>Rows that had no UOM when the run started.</summary>
        public int Missing { get; set; }

        /// <summary>Rows this run actually looked up.</summary>
        public int Attempted { get; set; }

        /// <summary>Rows that came back with a unit and were saved.</summary>
        public int Filled { get; set; }

        /// <summary>Looked up, but FBR places no unit restriction on the code.</summary>
        public int NoUnitPublished { get; set; }

        /// <summary>Lookups that failed (network, throttling).</summary>
        public int Failed { get; set; }

        /// <summary>Rows still without a unit once this run finished — run again to continue.</summary>
        public int RemainingWithoutUom { get; set; }

        public bool MoreToDo => RemainingWithoutUom > 0;

        public List<string> Errors { get; set; } = new();
        public DateTime? CompletedAt { get; set; }
    }

    public class HsCodeImportResultDto
    {
        /// <summary>Rows FBR returned (before de-duplication).</summary>
        public int TotalReceived { get; set; }

        /// <summary>Codes that did not exist locally and were inserted.</summary>
        public int Added { get; set; }

        /// <summary>Codes that already existed — the existing row was kept.</summary>
        public int AlreadyExisting { get; set; }

        /// <summary>Existing rows whose description / UOM changed upstream.</summary>
        public int Updated { get; set; }

        /// <summary>Rows rejected as unusable (blank or malformed code) plus duplicates within the feed.</summary>
        public int Skipped { get; set; }

        /// <summary>Placeholder Item Types created for codes that had none.</summary>
        public int ItemTypesCreated { get; set; }

        /// <summary>Where the data came from — "FBR (reference token)" / "FBR (company token)".</summary>
        public string Source { get; set; } = "";

        public DateTime CompletedAt { get; set; } = DateTime.UtcNow;

        /// <summary>
        /// Non-fatal problems, capped so a systematically bad feed cannot
        /// produce a megabyte of JSON. An import never aborts because of these.
        /// </summary>
        public List<string> Errors { get; set; } = new();
    }

    /// <summary>Masked view of the installation-wide FBR reference token.</summary>
    public class FbrReferenceTokenStatusDto
    {
        public bool IsConfigured { get; set; }

        /// <summary>Last 4 characters only, e.g. "••••1f2a". Never the token itself.</summary>
        public string? Preview { get; set; }

        public string Environment { get; set; } = "production";
        public DateTime? UpdatedAt { get; set; }

        /// <summary>Companies that carry their own FBR token, usable as a fallback source.</summary>
        public bool HasCompanyTokenFallback { get; set; }
    }

    /// <summary>Body of PUT /api/hscodes/reference-token.</summary>
    public class SetFbrReferenceTokenDto
    {
        public string Token { get; set; } = "";

        /// <summary>"production" (default) or "sandbox".</summary>
        public string? Environment { get; set; }
    }
}
