using System.Text.RegularExpressions;
using Serilog.Core;
using Serilog.Events;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Keeps Customer Portal tokens out of the logs.
    ///
    /// The token is a bearer capability over a client's invoices, and it travels
    /// in the URL path — which Serilog's request logging records verbatim on
    /// EVERY request as <c>RequestPath</c>. A log file, shipped or shoulder-read,
    /// would hand over live portals. This enricher rewrites the token segment to
    /// <c>***</c> before the event reaches any sink.
    ///
    /// Written as a global enricher rather than a custom message template so it
    /// also covers structured sinks and any other event that happens to carry a
    /// RequestPath property — masking at the template would only fix the text
    /// rendering of one logger.
    ///
    /// The companion to <see cref="SensitiveDataRedactor"/>, which covers request
    /// BODIES; between them the token has nowhere to leak.
    /// </summary>
    public class PortalTokenLogMasker : ILogEventEnricher
    {
        // /portal/<token> (the customer-facing SPA route) and
        // /api/public/customer-portal/<token>/... (the API). 43 base64url chars.
        private static readonly Regex TokenInPath = new(
            @"(/portal/|/api/public/customer-portal/)[A-Za-z0-9_-]{20,}",
            RegexOptions.Compiled | RegexOptions.IgnoreCase);

        public const string PropertyName = "RequestPath";

        public void Enrich(LogEvent logEvent, ILogEventPropertyFactory propertyFactory)
        {
            if (!logEvent.Properties.TryGetValue(PropertyName, out var value)) return;
            if (value is not ScalarValue { Value: string path }) return;
            if (path.IndexOf("portal", StringComparison.OrdinalIgnoreCase) < 0) return;

            var masked = Mask(path);
            if (!ReferenceEquals(masked, path))
                logEvent.AddOrUpdateProperty(new LogEventProperty(PropertyName, new ScalarValue(masked)));
        }

        /// <summary>Replaces the token segment with <c>***</c>. Public so tests can pin it.</summary>
        public static string Mask(string path) =>
            string.IsNullOrEmpty(path) ? path : TokenInPath.Replace(path, "$1***");
    }
}
