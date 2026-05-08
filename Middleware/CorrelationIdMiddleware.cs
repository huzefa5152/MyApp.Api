using System.Diagnostics;
using Serilog.Context;

namespace MyApp.Api.Middleware
{
    /// <summary>
    /// Stamps every request with a CorrelationId — either honoured from the
    /// inbound X-Correlation-ID header (frontend can pass one through to
    /// stitch a single user action across browser → API → FBR call) or
    /// generated server-side as a 32-char hex from a random GUID.
    ///
    /// Stored on:
    ///   • HttpContext.Items["CorrelationId"]  — for downstream services
    ///     that don't take Serilog.LogContext (audit log writers etc).
    ///   • Activity.Current.SetTag("CorrelationId", ...) — for
    ///     diagnostic-source consumers (OpenTelemetry exporters etc).
    ///   • Serilog.LogContext  — every ILogger call within the request
    ///     scope automatically picks up the property.
    ///   • Response header X-Correlation-ID — so the frontend can echo
    ///     it back on retries / error reports.
    ///
    /// Audit H-4 (2026-05-08): pre-fix there was no way to follow a single
    /// user action across multiple log lines; ten failures from one upload
    /// looked the same as ten unrelated ones.
    /// </summary>
    public class CorrelationIdMiddleware
    {
        private const string HeaderName = "X-Correlation-ID";
        public const string ContextItemKey = "CorrelationId";

        private readonly RequestDelegate _next;

        public CorrelationIdMiddleware(RequestDelegate next) => _next = next;

        public async Task InvokeAsync(HttpContext context)
        {
            var correlationId = ExtractOrGenerate(context);
            context.Items[ContextItemKey] = correlationId;
            context.Response.Headers[HeaderName] = correlationId;

            Activity.Current?.SetTag("CorrelationId", correlationId);

            using (LogContext.PushProperty("CorrelationId", correlationId))
            {
                await _next(context);
            }
        }

        private static string ExtractOrGenerate(HttpContext context)
        {
            if (context.Request.Headers.TryGetValue(HeaderName, out var inbound))
            {
                var v = inbound.ToString();
                // Sanity-cap inbound IDs at 64 chars and strip anything but
                // alphanumerics + hyphens. Prevents log-injection from a
                // malicious header value (we'll embed this in log output).
                if (!string.IsNullOrWhiteSpace(v) && v.Length <= 64)
                {
                    var clean = new string(v.Where(c => char.IsLetterOrDigit(c) || c == '-').ToArray());
                    if (clean.Length >= 8) return clean;
                }
            }
            // 32 hex chars from a random GUID — collision-resistant enough
            // for per-request tagging without committing to a UUID format.
            return Guid.NewGuid().ToString("N");
        }

        /// <summary>Pulls the current request's CorrelationId for use by services.</summary>
        public static string? FromContext(HttpContext? context)
            => context?.Items[ContextItemKey] as string;
    }
}
