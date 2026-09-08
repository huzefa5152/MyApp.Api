namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Canonical values for <c>Invoice.FbrStatus</c> and the retry-safety policy
    /// that governs transitions between them. This is the single source of truth
    /// for the FBR submission state machine — the atomic submit claim, the
    /// pre-submit guard, <c>PersistStatus</c>, the admin reset valve, and the
    /// front-end badges all reference it, so a mistyped literal can never silently
    /// weaken the double-submit guard (production incident 2026-08-05, invoice 3816).
    ///
    /// State machine:
    /// <code>
    ///   (null) ─┐
    ///   Failed ─┼─claim─▶ Submitting ─┬─FBR "Valid"────────────▶ Submitted (terminal*)
    ///  Validated┘                     ├─FBR rejects (4xx / "01" / "Invalid")──▶ Failed
    ///                                  └─timeout / 5xx / dropped / unreadable 2xx▶ Uncertain
    /// </code>
    /// Only <see cref="Validated"/>, <see cref="Failed"/>, and <c>null</c> are
    /// re-claimable (<see cref="IsSubmittable"/>). <see cref="Submitting"/>,
    /// <see cref="Submitted"/>, and <see cref="Uncertain"/> are NOT — a stuck
    /// bill is only re-opened by the audited admin reset endpoint.
    /// *Submitted is terminal for submission; it is reversed with a Credit Note.
    /// </summary>
    public static class FbrSubmissionStatus
    {
        /// <summary>Dry-run Validate passed. Re-claimable for a real submit.</summary>
        public const string Validated = "Validated";

        /// <summary>A submit POST is in flight (the atomic claim holds it). NOT re-claimable.</summary>
        public const string Submitting = "Submitting";

        /// <summary>FBR accepted the invoice and issued an IRN. Terminal for submission.</summary>
        public const string Submitted = "Submitted";

        /// <summary>
        /// The submit definitively did NOT commit at FBR (a 4xx, or a business
        /// rejection over a 2xx). Safe to fix the data and resubmit — re-claimable.
        /// </summary>
        public const string Failed = "Failed";

        /// <summary>
        /// The submit's outcome is unknown — FBR may already hold the invoice
        /// (timeout after send, HTTP 5xx, connection dropped mid-response, or a
        /// 2xx we could not interpret). NOT re-claimable: an administrator must
        /// reconcile with FBR before any resubmission, or a duplicate IRN results.
        /// </summary>
        public const string Uncertain = "Uncertain";

        /// <summary>
        /// Whether a bill in the given status may be claimed for a fresh submit.
        /// Mirrors the WHERE clause of the atomic claim in FbrService — keep the
        /// two in step. (The EF query inlines the constants directly because
        /// method calls are not translatable to SQL.)
        /// </summary>
        public static bool IsSubmittable(string? status) =>
            string.IsNullOrEmpty(status) || status == Failed || status == Validated;

        /// <summary>
        /// The status a bill must land in after a submit attempt that did not
        /// clearly succeed, decided purely from the transport outcome per
        /// HTTP idempotency semantics (RFC 9110 §9.2.2) and payment-gateway
        /// practice — retry only when we KNOW FBR did not process the request:
        /// <list type="bullet">
        ///   <item>HTTP <b>4xx</b> — FBR evaluated the request and refused it;
        ///         nothing was committed → <see cref="Failed"/> (safe to resubmit).</item>
        ///   <item>HTTP <b>5xx</b> — FBR server error; it may have committed the
        ///         invoice before failing → <see cref="Uncertain"/>.</item>
        ///   <item><b>0</b> (no HTTP response: timeout/DNS/reset) — only the
        ///         caller knows whether bytes were sent; pass <paramref name="requestSent"/>.
        ///         Sent → <see cref="Uncertain"/>; never sent → <see cref="Failed"/>.</item>
        /// </list>
        /// Business rejections carried over a 2xx (FBR statusCode "01" / "Invalid")
        /// are known-not-committed and are set to <see cref="Failed"/> at their
        /// own call sites; an unreadable 2xx is <see cref="Uncertain"/> there.
        /// </summary>
        public static string OutcomeFor(int httpStatus, bool requestSent)
        {
            if (httpStatus >= 400 && httpStatus < 500) return Failed;       // definitive rejection
            if (httpStatus >= 500) return Uncertain;                        // server error — indeterminate
            return requestSent ? Uncertain : Failed;                        // no response: depends on whether we sent
        }
    }
}
