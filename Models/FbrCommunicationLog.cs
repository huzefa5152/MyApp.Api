namespace MyApp.Api.Models
{
    /// <summary>
    /// Dedicated log for every FBR / PRAL HTTP call. See audit H-3
    /// (AUDIT_2026_05_08_OBSERVABILITY.md): pre-fix, FBR traffic was
    /// mixed into AuditLogs with the response stored in StackTrace.
    /// Operators couldn't isolate FBR health without SQL.
    ///
    /// Writes happen from FbrService.AuditFbr and the reference-API
    /// helpers. The legacy AuditLog mirror stays in place for ~3 months
    /// while operators get used to the new monitor page.
    /// </summary>
    public class FbrCommunicationLog
    {
        public long Id { get; set; }
        public DateTime Timestamp { get; set; } = DateTime.UtcNow;

        // CompanyId is required for tenant filtering in the monitor UI.
        // Reference-API calls always have one too (we route via the
        // company's FBR token).
        public int CompanyId { get; set; }

        // Set when the call corresponds to a specific bill (Submit /
        // Validate / Preview); null for reference-data fetches.
        public int? InvoiceId { get; set; }

        // Stitches across the request → service → FBR call boundary.
        // Pulled from CorrelationIdMiddleware via HttpContext.
        public string? CorrelationId { get; set; }

        // Submit | Validate | Preview | StatusCheck | RefData
        public string Action { get; set; } = "";

        // Full URL (no token in querystring — FBR uses Bearer header).
        public string Endpoint { get; set; } = "";

        public string HttpMethod { get; set; } = "POST";

        // Null when the request never reached FBR (DNS / network).
        public int? HttpStatusCode { get; set; }

        // Lifecycle:
        //   sent          — request flushed to network, no response yet
        //   acknowledged  — FBR returned 2xx (Validate)
        //   submitted     — FBR returned 2xx + IRN issued (Submit)
        //   rejected      — FBR returned 2xx but ValidationResponse.Status="Invalid"
        //   failed        — non-2xx, network error, or malformed response
        //   retrying      — Polly is mid-retry; written on first attempt failure
        //   uncertain     — request timed out after sending; resubmit risky
        public string Status { get; set; } = "";

        // FBR's own diagnostic codes (e.g. "0002", "0099", "0401").
        // Separate from HttpStatusCode so a 2xx-with-validation-error is
        // queryable by the FBR error code directly.
        public string? FbrErrorCode { get; set; }

        public string? FbrErrorMessage { get; set; }

        // Wall-clock duration including any retries, captured from
        // Stopwatch around the HttpClient call.
        public int RequestDurationMs { get; set; }

        // 0 for first attempt; Polly increments for retries.
        public int RetryAttempt { get; set; }

        // Both bodies pass through ISensitiveDataRedactor — NTN/CNIC
        // masked to last-4, credentials redacted to "***". Caps at
        // ~8 KB each; longer payloads are truncated with "(truncated)".
        public string? RequestBodyMasked { get; set; }
        public string? ResponseBodyMasked { get; set; }

        // Operator who triggered the action. Null for system-driven
        // background calls (none today, but the column is here for
        // when scheduled retries land in Phase 3).
        public string? UserName { get; set; }
    }
}
