using System.Text.RegularExpressions;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Centralised redactor for sensitive fields before they hit the
    /// AuditLogs table or any Serilog sink. Two operations:
    ///
    ///   • Redact (full)  — replace value with "***". Used for credentials
    ///     where the original is dangerous to retain even partially
    ///     (passwords, JWTs, FBR tokens, API keys, connection strings).
    ///
    ///   • Mask (last-4)  — keep last 4 chars, replace rest with "*".
    ///     Used for tax IDs (NTN/CNIC) so support can recognise the
    ///     party from a complaint without leaking the full ID.
    ///
    /// Why a shared service:
    ///   GlobalExceptionMiddleware was redacting; FbrService.LogFbrActionAsync
    ///   was not. Lifting both into one place means every audit-log call
    ///   site gets the same protection automatically and the regex stays
    ///   consistent (see audit C-2, 2026-05-08 observability audit).
    /// </summary>
    public interface ISensitiveDataRedactor
    {
        /// <summary>Apply both redact + mask passes to a JSON body. Safe for null/empty.</summary>
        string? Scrub(string? jsonBody);
    }

    public sealed class SensitiveDataRedactor : ISensitiveDataRedactor
    {
        // Full-redact field names — values become "***".
        private static readonly string[] RedactFieldNames = new[]
        {
            "password", "currentpassword", "newpassword", "oldpassword",
            "passwordhash", "confirmpassword",
            "fbrtoken", "token", "apikey", "api_key", "secret",
            "jwt", "authorization", "bearer",
            "connectionstring",
        };

        // Mask field names — keep last 4 chars, replace rest with "*".
        // Pakistan tax IDs:
        //   • NTN: 7-13 digits (legacy 7, modern 13).
        //   • CNIC: 13 digits.
        //   • SellerNTNCNIC / BuyerNTNCNIC: FBR Digital Invoicing payload fields.
        private static readonly string[] MaskFieldNames = new[]
        {
            "ntn", "cnic", "nicnumber",
            "sellerntncnic", "buyerntncnic",
            "buyerntn", "sellerntn",
            "buyercnic", "sellercnic",
        };

        private static readonly Regex RedactRegex = new(
            @"(""(?:" + string.Join("|", RedactFieldNames) + @")""\s*:\s*)(""(?:[^""\\]|\\.)*""|null)",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        // Captures the JSON value (string, in capture group 2) so we can
        // mask its contents while preserving the wrapping quotes.
        private static readonly Regex MaskRegex = new(
            @"(""(?:" + string.Join("|", MaskFieldNames) + @")""\s*:\s*"")((?:[^""\\]|\\.)*)("")",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        public string? Scrub(string? jsonBody)
        {
            if (string.IsNullOrEmpty(jsonBody)) return jsonBody;

            // Pass 1: full redaction for credentials.
            var redacted = RedactRegex.Replace(jsonBody, "$1\"***\"");

            // Pass 2: last-4 masking for tax IDs.
            var masked = MaskRegex.Replace(redacted, m =>
            {
                var prefix  = m.Groups[1].Value;   // ` "ntn":"`
                var raw     = m.Groups[2].Value;   // value chars
                var suffix  = m.Groups[3].Value;   // closing `"`
                if (raw.Length <= 4) return m.Value; // too short to meaningfully mask
                var lastFour = raw[^4..];
                var maskedValue = new string('*', raw.Length - 4) + lastFour;
                return prefix + maskedValue + suffix;
            });

            return masked;
        }
    }
}
