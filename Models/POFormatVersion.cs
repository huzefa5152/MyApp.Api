namespace MyApp.Api.Models
{
    // Append-only history of every rule-set revision for a POFormat.
    // Regression tests (Phase 5) replay the golden set against previous
    // versions to guarantee the non-breaking constraint, and operators can
    // roll back by copying an old RuleSetJson onto the parent format.
    public class POFormatVersion
    {
        public int Id { get; set; }

        public int POFormatId { get; set; }
        public POFormat? POFormat { get; set; }

        public int Version { get; set; }

        public string RuleSetJson { get; set; } = "{}";

        public string? ChangeNote { get; set; }

        // Username snapshot at time of change — cheaper than FK + survives user deletes.
        public string? CreatedBy { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }
}
