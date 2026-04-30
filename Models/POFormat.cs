namespace MyApp.Api.Models
{
    // A PO format is a recognisable client/template layout. Every incoming PDF is
    // fingerprinted and matched against this table — if matched, the stored
    // rule-set parses it deterministically (no LLM call). New formats are
    // created once (LLM-assisted) and then frozen.
    public class POFormat
    {
        public int Id { get; set; }

        // Human-friendly label set during onboarding, e.g. "Acme Industries PO v1".
        public string Name { get; set; } = "";

        // Company scope. POFormats are always owned by one of our companies
        // (the buyer's side). Required in the new onboarding UI.
        public int? CompanyId { get; set; }
        public Company? Company { get; set; }

        // Client scope — which client (vendor) this PO template belongs to.
        // Each (CompanyId, ClientId) pair has exactly one format in the
        // Configuration UI; null = legacy pre-ClientId format.
        public int? ClientId { get; set; }
        public Client? Client { get; set; }

        // Common Client (group) scope — preferred over ClientId for new
        // formats. When a PO is configured against a group, the SAME
        // template applies to that legal entity in EVERY tenant that has
        // them as a client. Nullable + alongside ClientId for backward
        // compat: legacy formats keep working via ClientId; new formats
        // save ClientGroupId; on import the matcher prefers group-based
        // resolution and falls back to ClientId.
        public int? ClientGroupId { get; set; }
        public ClientGroup? ClientGroup { get; set; }

        // SHA-256 (hex) of the normalised, sorted keyword signature.
        // Exact match on this is the primary routing mechanism.
        public string SignatureHash { get; set; } = "";

        // Pipe-delimited sorted keyword set extracted from the PDF (e.g. "date|ntn|po no|supplier|total").
        // Kept in the row for quick Jaccard-similarity fallback without rehashing.
        public string KeywordSignature { get; set; } = "";

        // The frozen rule-set consumed by the deterministic parser engine.
        // Shape is enforced by the parser (Phase 2) — stored as JSON so we can
        // evolve the schema without repeated migrations.
        public string RuleSetJson { get; set; } = "{}";

        // Monotonic version number. Bumped whenever RuleSetJson changes.
        public int CurrentVersion { get; set; } = 1;

        // Soft-disable without deleting — so a misbehaving format can be taken
        // out of the matching pool while we fix it, preserving history.
        public bool IsActive { get; set; } = true;

        // Free-form operator notes (e.g. "Covers PDFs issued by Acme Lahore branch only").
        public string? Notes { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }
}
