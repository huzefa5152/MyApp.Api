namespace MyApp.Api.DTOs
{
    public class POFormatDto
    {
        public int Id { get; set; }
        public string Name { get; set; } = "";
        public int? CompanyId { get; set; }
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
        public int CurrentVersion { get; set; }
        public bool IsActive { get; set; }
        public DateTime UpdatedAt { get; set; }
    }

    public class POFormatCreateDto
    {
        public string Name { get; set; } = "";
        public int? CompanyId { get; set; }
        public string RawText { get; set; } = "";     // the sample PDF's raw text — we derive the fingerprint server-side
        public string? RuleSetJson { get; set; }      // optional on Phase 1 (defaults to empty {})
        public string? Notes { get; set; }
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
