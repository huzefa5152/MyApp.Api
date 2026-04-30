namespace MyApp.Api.DTOs
{
    public class POFormatDto
    {
        public int Id { get; set; }
        public string Name { get; set; } = "";
        public int? CompanyId { get; set; }
        public string? CompanyName { get; set; }
        public int? ClientId { get; set; }
        public string? ClientName { get; set; }
        // Surfaced to the form so it can pre-select the right Common
        // Client on edit without falling back to a clientId-based hop.
        public int? ClientGroupId { get; set; }
        public string? ClientGroupName { get; set; }
        public string SignatureHash { get; set; } = "";
        public string KeywordSignature { get; set; } = "";
        public string RuleSetJson { get; set; } = "{}";
        public int CurrentVersion { get; set; }
        public bool IsActive { get; set; }
        public string? Notes { get; set; }
        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }
    }

    public class POFormatListItemDto
    {
        public int Id { get; set; }
        public string Name { get; set; } = "";
        public int? CompanyId { get; set; }
        public string? CompanyName { get; set; }
        public int? ClientId { get; set; }
        public string? ClientName { get; set; }
        public int? ClientGroupId { get; set; }
        // ClientGroup display name — when the format is bound to a
        // Common Client this is what the operator should see in the
        // table column ("LOTTE Kolson", not Hakimi's per-tenant row).
        public string? ClientGroupName { get; set; }
        public int CurrentVersion { get; set; }
        public bool IsActive { get; set; }
        public DateTime UpdatedAt { get; set; }
    }

    public class POFormatCreateDto
    {
        public string Name { get; set; } = "";
        public int? CompanyId { get; set; }
        public int? ClientId { get; set; }
        // ClientGroupId — the Common Clients grouping FK. Auto-populated
        // by the controller from the linked Client's group so the saved
        // format applies in every tenant that has that client (uncommon
        // single-company clients still have a 1-member group, so the
        // semantics are identical to the legacy ClientId-only flow).
        public int? ClientGroupId { get; set; }
        public string RawText { get; set; } = "";     // the sample PDF's raw text — we derive the fingerprint server-side
        public string? RuleSetJson { get; set; }      // optional (defaults to empty {}) — power users can paste a full anchored-v1 ruleset
        public string? Notes { get; set; }
    }

    // Lightweight onboarding payload. The operator gives us the 5 label/header
    // strings they see on the PDF — server transforms that into a full
    // "simple-headers-v1" rule-set, so no hand-crafted regex is needed.
    public class POFormatSimpleCreateDto
    {
        public string Name { get; set; } = "";
        public int? CompanyId { get; set; }
        public int? ClientId { get; set; }
        public string RawText { get; set; } = "";         // paste the extracted text from a sample PDF
        public string PoNumberLabel { get; set; } = "";   // e.g. "P.O. #"
        public string PoDateLabel { get; set; } = "";     // e.g. "P.O. Date"
        public string DescriptionHeader { get; set; } = "";   // e.g. "Item Name"
        public string QuantityHeader { get; set; } = "";      // e.g. "Quantity"
        public string UnitHeader { get; set; } = "";          // e.g. "Unit"
        public string? Notes { get; set; }
    }

    // Edit payload — same 5 strings + metadata. RawText is optional: pass
    // it to replace the sample text and recompute the fingerprint hash
    // (useful when the client's template has changed and the old hash no
    // longer matches incoming PDFs). Omit to keep the existing fingerprint.
    public class POFormatSimpleUpdateDto
    {
        public string Name { get; set; } = "";
        public bool IsActive { get; set; } = true;
        public int? ClientId { get; set; }
        public string PoNumberLabel { get; set; } = "";
        public string PoDateLabel { get; set; } = "";
        public string DescriptionHeader { get; set; } = "";
        public string QuantityHeader { get; set; } = "";
        public string UnitHeader { get; set; } = "";
        public string? Notes { get; set; }
        /// <summary>Optional — pass to replace the sample + recompute fingerprint.</summary>
        public string? RawText { get; set; }
    }

    public class POFormatUpdateRulesDto
    {
        public string RuleSetJson { get; set; } = "{}";
        public string? ChangeNote { get; set; }
    }

    public class POFormatUpdateMetaDto
    {
        public string Name { get; set; } = "";
        public bool IsActive { get; set; } = true;
        public string? Notes { get; set; }
    }

    public class POFormatVersionDto
    {
        public int Id { get; set; }
        public int Version { get; set; }
        public string RuleSetJson { get; set; } = "{}";
        public string? ChangeNote { get; set; }
        public string? CreatedBy { get; set; }
        public DateTime CreatedAt { get; set; }
    }

    public class FingerprintRequestDto
    {
        public string RawText { get; set; } = "";
        public int? CompanyId { get; set; }
    }

    public class FingerprintResponseDto
    {
        public string Hash { get; set; } = "";
        public string Signature { get; set; } = "";
        public List<string> Keywords { get; set; } = new();
        public POFormatDto? MatchedFormat { get; set; }
        public double? MatchSimilarity { get; set; }   // 1.0 for exact hash, 0..1 for Jaccard fallback
        public bool IsExactMatch { get; set; }
    }
}
