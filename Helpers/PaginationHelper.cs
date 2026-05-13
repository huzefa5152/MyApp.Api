namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Single source of truth for clamping caller-supplied pageSize values.
    /// Audit C-11 (2026-05-13): pre-fix, every paged read endpoint accepted
    /// an unbounded pageSize from the query string, making the API
    /// trivially DoS-able with <c>?pageSize=1000000</c>. This helper caps
    /// the per-page row count to a sane upper bound.
    ///
    /// Usage in controllers:
    ///   var size = PaginationHelper.Clamp(pageSize, _defaultPageSize);
    ///
    /// For audit-log-style endpoints that legitimately need a higher cap,
    /// pass <c>max: 200</c>.
    /// </summary>
    public static class PaginationHelper
    {
        /// <summary>Default upper bound on pageSize for ordinary list endpoints.</summary>
        public const int DefaultMax = 100;

        /// <summary>Higher upper bound used for audit-log / monitor screens.</summary>
        public const int AuditMax = 200;

        /// <summary>Default page size when caller passes none.</summary>
        public const int DefaultPageSize = 25;

        /// <summary>
        /// Clamp a caller-supplied pageSize to the range [1, max]. When the
        /// caller omits pageSize entirely, falls back to
        /// <paramref name="defaultSize"/> (which is itself also clamped).
        /// </summary>
        public static int Clamp(int? requested, int defaultSize = DefaultPageSize, int max = DefaultMax)
        {
            if (max < 1) max = 1;
            var fallback = System.Math.Clamp(defaultSize, 1, max);
            if (!requested.HasValue) return fallback;
            return System.Math.Clamp(requested.Value, 1, max);
        }

        /// <summary>
        /// Clamp a caller-supplied page number to ≥ 1.
        /// </summary>
        public static int ClampPage(int requested) => requested < 1 ? 1 : requested;
    }
}
