using System.Text.RegularExpressions;
using System.Web;

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

        /// <summary>
        /// Audit C-10 / H-7 (2026-05-13): scrub a form-encoded
        /// (application/x-www-form-urlencoded) body. The JSON-regex
        /// Scrub() would miss these because they're key=val pairs, not
        /// JSON. Detection key-set is the same as the JSON path.
        /// </summary>
        string? ScrubFormEncoded(string? formBody);

        /// <summary>
        /// Best-effort scrub for a multipart body. The audit-log middleware
        /// already truncates these aggressively, but field names like
        /// `name="password"\r\n\r\nvalue` still leak. This redacts the
        /// value blocks for known sensitive fields.
        /// </summary>
        string? ScrubMultipart(string? multipartBody);

        /// <summary>
        /// Generic entry point — dispatches to Scrub / ScrubFormEncoded /
        /// ScrubMultipart based on the Content-Type. Safe for null /
        /// empty bodies, returns the input unchanged when content type
        /// is unknown.
        /// </summary>
        string? ScrubByContentType(string? body, string? contentType);
    }

    public sealed class SensitiveDataRedactor : ISensitiveDataRedactor
    {
        // Full-redact field names — values become "***".
        // Audit H-7 (2026-05-13): added strn / address / phone family so
        // form-encoded and multipart bodies don't leak supplier address
        // or contact info into AuditLogs.
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
        //   • STRN: Sales Tax Registration Number (audit H-7).
        //   • Address / phone / email — masked to keep support context
        //     without storing full PII.
        private static readonly string[] MaskFieldNames = new[]
        {
            "ntn", "cnic", "nicnumber",
            "sellerntncnic", "buyerntncnic",
            "buyerntn", "sellerntn",
            "buyercnic", "sellercnic",
            "strn", "buyerstrn", "sellerstrn",
            "address", "selleraddress", "buyeraddress",
            "fulladdress",
            "phone", "phonenumber", "mobilenumber",
            "email", "emailaddress",
        };

        private static readonly Regex RedactRegex = new(
            @"(""(?:" + string.Join("|", RedactFieldNames) + @")""\s*:\s*)(""(?:[^""\\]|\\.)*""|null)",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        // Captures the JSON value (string, in capture group 2) so we can
        // mask its contents while preserving the wrapping quotes.
        private static readonly Regex MaskRegex = new(
            @"(""(?:" + string.Join("|", MaskFieldNames) + @")""\s*:\s*"")((?:[^""\\]|\\.)*)("")",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        // Form-encoded: key=val&key2=val2 — match a sensitive key followed
        // by = and capture the value up to & or end-of-string.
        private static readonly Regex FormRedactRegex = new(
            @"((?:^|&)(?:" + string.Join("|", RedactFieldNames) + @")=)([^&]*)",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);
        private static readonly Regex FormMaskRegex = new(
            @"((?:^|&)(?:" + string.Join("|", MaskFieldNames) + @")=)([^&]*)",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        // Multipart: name="fieldname" ... value ... boundary. Match the
        // Content-Disposition line and capture the value chunk between the
        // header and the next boundary marker.
        private static readonly Regex MultipartRedactRegex = new(
            @"(Content-Disposition:\s*form-data;\s*name=""(?:" + string.Join("|", RedactFieldNames) + @")""[^\r\n]*\r?\n(?:[^\r\n]*\r?\n)*\r?\n)([^\r\n]*)",
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

        public string? ScrubFormEncoded(string? formBody)
        {
            if (string.IsNullOrEmpty(formBody)) return formBody;

            // Full redaction first.
            var redacted = FormRedactRegex.Replace(formBody, "$1***");
            // Then last-4 masking on the remainder.
            var masked = FormMaskRegex.Replace(redacted, m =>
            {
                var prefix = m.Groups[1].Value;
                var raw = m.Groups[2].Value;
                // The captured value is URL-encoded; decode then re-encode
                // so a CNIC like "12345-1234567-1" still keeps the last
                // four meaningful digits.
                var decoded = HttpUtility.UrlDecode(raw);
                if (decoded.Length <= 4) return m.Value;
                var lastFour = decoded[^4..];
                var maskedValue = new string('*', decoded.Length - 4) + lastFour;
                return prefix + Uri.EscapeDataString(maskedValue);
            });
            return masked;
        }

        public string? ScrubMultipart(string? multipartBody)
        {
            if (string.IsNullOrEmpty(multipartBody)) return multipartBody;
            // For credentials we just redact the whole value line.
            return MultipartRedactRegex.Replace(multipartBody, "$1***");
        }

        public string? ScrubByContentType(string? body, string? contentType)
        {
            if (string.IsNullOrEmpty(body)) return body;
            if (string.IsNullOrWhiteSpace(contentType))
            {
                // Best effort — try JSON path which is safe on key=val too
                // (no-op when there are no JSON delimiters).
                return Scrub(body);
            }

            var ct = contentType.ToLowerInvariant();
            if (ct.Contains("application/json")) return Scrub(body);
            if (ct.Contains("application/x-www-form-urlencoded")) return ScrubFormEncoded(body);
            if (ct.Contains("multipart/form-data")) return ScrubMultipart(body);
            return Scrub(body);
        }
    }
}
