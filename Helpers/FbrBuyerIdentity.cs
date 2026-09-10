using MyApp.Api.Models;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// The registration number a BUYER goes on an FBR invoice under.
    ///
    /// FBR's invoice API takes <c>buyerNTNCNIC</c> as a 7-CHARACTER NTN or a
    /// 13-digit CNIC. IRIS issues NTNs like <c>A113680-1</c>: the letter is one
    /// of the seven characters and <c>-1</c> is the check digit. Proven against
    /// the sandbox on 2026-09-10 for a real registered taxpayer:
    ///   "A113680"    Valid                         (letter kept, check digit dropped)
    ///   "A113680-1"  [0002] not in proper format   (check digit sent)
    ///   "1136801"    [0205] unregistered           (letter stripped: a DIFFERENT number)
    ///   "A1136801"   [0002] not in proper format   (eight characters)
    /// Three live buyers carried such NTNs and the old digits-only sanitiser
    /// turned every one of their bills into a [0205].
    ///
    /// So this is the ONE rule, used by pre-flight, the payload and the challan
    /// readiness gate: an NTN files as its first seven letters-or-digits with
    /// the check digit dropped; a CNIC alone files as its 13 digits.
    /// </summary>
    public static class FbrBuyerIdentity
    {
        /// <summary>
        /// Reduces a stored NTN to the 7 digits FBR files:
        ///   "1234567-8"        suffixed (dash + check digit)         → "1234567"
        ///   "12-34-5678901-2"  corporate (multi-dash, 11+ digits)    → digits 4..11
        ///   "1234567" / "12345678"                                    → first 7
        /// A value with fewer than 7 digits comes back as-is so the caller can
        /// report its length. Letters are dropped here, which is exactly why a
        /// letter-prefixed NTN must be routed to <see cref="Resolve"/> instead.
        /// </summary>
        public static string SanitizeNtn(string? ntn)
        {
            if (string.IsNullOrWhiteSpace(ntn)) return "";
            var digits = new string(ntn.Where(char.IsDigit).ToArray());
            if (digits.Length < 7) return digits;
            var dashCount = ntn.Count(c => c == '-');
            if (dashCount >= 3 && digits.Length >= 11)
                return digits.Substring(4, 7);  // corporate "NN-NN-NNNNNNN-C"
            return digits.Substring(0, 7);
        }

        public static string Digits(string? v)
            => string.IsNullOrWhiteSpace(v) ? "" : new string(v.Where(char.IsDigit).ToArray());

        /// <summary>"A113680-1", "C650414-2": an NTN whose first character is a letter.</summary>
        public static bool IsLetterPrefixed(string? ntn)
            => !string.IsNullOrWhiteSpace(ntn) && ntn.Any(char.IsLetter);

        /// <summary>
        /// "A113680-1" -> "A113680": the seven characters FBR files, letter kept,
        /// check digit dropped. Fewer than seven come back as-is for the caller
        /// to report.
        /// </summary>
        public static string SanitizeLetterNtn(string? ntn)
        {
            if (string.IsNullOrWhiteSpace(ntn)) return "";
            var core = new string(ntn.Where(char.IsLetterOrDigit).ToArray()).ToUpperInvariant();
            return core.Length <= 7 ? core : core.Substring(0, 7);
        }

        /// <summary>
        /// The number to file for this buyer, or the reason none can be.
        /// <paramref name="registered"/> is FBR's buyer registration type: for an
        /// Unregistered buyer the number is optional, so an unusable one resolves
        /// to "" rather than an error.
        /// </summary>
        public static (string Value, string? Error) Resolve(string? ntn, string? cnic, bool registered)
        {
            var cnicDigits = Digits(cnic);
            var hasCnic = cnicDigits.Length == 13;

            if (IsLetterPrefixed(ntn))
            {
                var letterNtn = SanitizeLetterNtn(ntn);
                if (letterNtn.Length == 7) return (letterNtn, null);
                if (hasCnic) return (cnicDigits, null);
                if (!registered) return ("", null);
                return ("", $"Buyer NTN '{ntn!.Trim()}' must be 7 characters before the check digit (current: {letterNtn.Length}). [FBR 0002]");
            }

            var ntnDigits = SanitizeNtn(ntn);
            if (ntnDigits.Length > 0)
            {
                if (ntnDigits.Length == 7) return (ntnDigits, null);
                if (hasCnic) return (cnicDigits, null);
                if (!registered) return ("", null);
                return ("", $"Buyer NTN must be 7 digits (current: {ntnDigits.Length}). [FBR 0002]");
            }

            if (cnicDigits.Length > 0)
            {
                if (hasCnic) return (cnicDigits, null);
                if (!registered) return ("", null);
                return ("", $"Buyer CNIC must be 13 digits (current: {cnicDigits.Length}). [FBR 0002]");
            }

            return registered
                ? ("", "Buyer NTN or CNIC is required for registered buyers. [FBR 0009]")
                : ("", null);
        }

        /// <summary>Convenience for the readiness gate: can this buyer be filed as-is?</summary>
        public static bool CanFile(Client client, bool registered)
            => Resolve(client.NTN, client.CNIC, registered).Error == null;
    }
}
