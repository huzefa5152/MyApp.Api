using System.Text.RegularExpressions;
using Serilog.Core;
using Serilog.Events;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Keeps Customer Portal tokens out of the logs.
    ///
    /// The token is a bearer capability over a client's invoices, and it travels
    /// in the URL PATH — which Serilog's request logging records verbatim on
    /// every request as <c>RequestPath</c>. A log file, shipped to a support
    /// inbox or read over a shoulder, would hand over live portals. This
    /// enricher rewrites the token segment to <c>***</c> before the event
    /// reaches any sink.
    ///
    /// Written as a global enricher rather than a custom message template so it
    /// also covers structured sinks and any other event that happens to carry a
    /// RequestPath — masking in the template would only fix the text rendering
    /// of one logger.
    ///
    /// The companion to <see cref="SensitiveDataRedactor"/>, which covers
    /// request BODIES. Between them the token has nowhere to leak.
    /// </summary>
    public class PortalTokenLogMasker : ILogEventEnricher
    {
        // /portal/<token> (the customer-facing page) and
        // /api/public/customer-portal/<token>/... (the API). 43 base64url chars,
        // matched loosely from 20 so a truncated or experimental token is masked
        // too — over-masking a path costs nothing, under-masking leaks a portal.
        private static readonly Regex TokenInPath = new(
            @"(/portal/|/api/public/customer-portal/)[A-Za-z0-9_-]{20,}",
            RegexOptions.Compiled | RegexOptions.IgnoreCase);

        public const string PropertyName = "RequestPath";

        public void Enrich(LogEvent logEvent, ILogEventPropertyFactory propertyFactory)
        {
            // ASP.NET and exception logging also use Path (and sometimes a full
            // URI), so restricting this to RequestPath misses error events.
            foreach (var property in logEvent.Properties.ToList())
            {
                if (property.Value is not ScalarValue { Value: string path }) continue;
                if (path.IndexOf("portal", StringComparison.OrdinalIgnoreCase) < 0) continue;
                var masked = Mask(path);
                if (!string.Equals(masked, path, StringComparison.Ordinal))
                    logEvent.AddOrUpdateProperty(new LogEventProperty(property.Key, new ScalarValue(masked)));
            }
        }

        /// <summary>Replaces the token segment with <c>***</c>. Public so the
        /// suite can pin it without going through Serilog.</summary>
        public static string Mask(string path) =>
            string.IsNullOrEmpty(path) ? path : TokenInPath.Replace(path, "$1***");
    }
}
