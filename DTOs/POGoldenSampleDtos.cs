namespace MyApp.Api.DTOs
{
    // The canonical "what should the parser extract from this PDF" shape.
    // Kept minimal so trivial formatting drift (whitespace, warning order)
    // doesn't trigger false regressions.
    public class ExpectedResultDto
    {
        public string? PoNumber { get; set; }
        public DateTime? PoDate { get; set; }
        public List<ExpectedItemDto> Items { get; set; } = new();
    }

    public class ExpectedItemDto
    {
        public string Description { get; set; } = "";
        public decimal Quantity { get; set; }
        public string Unit { get; set; } = "";
    }

    public class POGoldenSampleDto
    {
        public int Id { get; set; }
        public int POFormatId { get; set; }
        public string Name { get; set; } = "";
        public string? OriginalFileName { get; set; }
        public string RawText { get; set; } = "";
        public ExpectedResultDto Expected { get; set; } = new();
        public string? Notes { get; set; }
        public string Status { get; set; } = "verified";
        public string? CreatedBy { get; set; }
        public DateTime CreatedAt { get; set; }
    }

    public class POGoldenSampleCreateDto
    {
        public string Name { get; set; } = "";
        public string? OriginalFileName { get; set; }
        public string RawText { get; set; } = "";
        public ExpectedResultDto Expected { get; set; } = new();
        public string? Notes { get; set; }
        // Optional base64-encoded PDF bytes. If provided, stored for later review.
        public string? PdfBase64 { get; set; }
    }

    // Report returned by the regression harness. The gate refuses the
    // proposed rule-set if any "verified" sample fails.
    public class RegressionReportDto
    {
        public bool Passed { get; set; }
        public int TotalSamples { get; set; }
        public int PassedSamples { get; set; }
        public int FailedSamples { get; set; }
        public int SkippedSamples { get; set; }
        public List<SampleOutcomeDto> Outcomes { get; set; } = new();
    }

    public class SampleOutcomeDto
    {
        public int SampleId { get; set; }
        public int FormatId { get; set; }
        public string SampleName { get; set; } = "";
        public string FormatName { get; set; } = "";
        // "pass", "fail", "skip" (skipped = pending sample)
        public string Result { get; set; } = "";
        public List<string> Diffs { get; set; } = new();
        public ExpectedResultDto? Expected { get; set; }
        public ExpectedResultDto? Actual { get; set; }
    }

    public class TestRuleSetRequestDto
    {
        public string RuleSetJson { get; set; } = "{}";
        // Optional: if provided, the test is also replayed against this raw
        // text as a one-off (not persisted as a sample).
        public string? AdditionalRawText { get; set; }
    }
}
