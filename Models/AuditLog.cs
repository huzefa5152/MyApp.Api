namespace MyApp.Api.Models
{
    public class AuditLog
    {
        public int Id { get; set; }
        public DateTime Timestamp { get; set; } = DateTime.UtcNow;
        public string Level { get; set; } = "Error"; // Error, Warning, Info
        public string? UserName { get; set; }
        public string HttpMethod { get; set; } = "";
        public string RequestPath { get; set; } = "";
        public int StatusCode { get; set; }
        public string ExceptionType { get; set; } = "";
        public string Message { get; set; } = "";
        public string? StackTrace { get; set; }
        public string? RequestBody { get; set; }
        public string? QueryString { get; set; }

        // Audit H-7 (2026-05-08): tenant context for multi-tenant log
        // queries. Nullable for system-wide events (auth failures before
        // a company is known, bootstrap events, etc).
        public int? CompanyId { get; set; }

        // Audit H-4 (2026-05-08): stitches a single user action across
        // multiple log lines. Populated by GlobalExceptionMiddleware
        // from CorrelationIdMiddleware's HttpContext.Items entry.
        public string? CorrelationId { get; set; }

        // Audit H-8 (2026-05-08): dedup key. SHA1 over
        // (Level + ExceptionType + Message-trimmed + RequestPath).
        // Same fingerprint within DedupWindowMinutes increments
        // OccurrenceCount on the existing row instead of inserting.
        public string? Fingerprint { get; set; }

        // First time this fingerprint was seen in the active window.
        // Equal to Timestamp on insert; doesn't change on dedup.
        public DateTime? FirstOccurrence { get; set; }

        // Most-recent time this fingerprint was seen. Updated on dedup.
        public DateTime? LastOccurrence { get; set; }

        // Number of times this fingerprint has been seen since
        // FirstOccurrence. Defaults to 1; incremented on dedup.
        public int OccurrenceCount { get; set; } = 1;
    }
}
