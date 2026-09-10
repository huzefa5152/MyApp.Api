using MyApp.Api.Models;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// The registration number a BUYER goes on an FBR invoice under.
    ///
    /// FBR's invoice API takes <c>buyerNTNCNIC</c> as either a 7-digit NTN or a
    /// 13-digit CNIC and nothing else. But IRIS also issues NTNs like
    /// <c>A113680-1</c> — letter-prefixed, a real registered taxpayer (verified on
    /// IRIS 2026-09-10, active since 2022). Three live buyers had one. Stripping
    /// the letter to <c>1136801</c> produced a number FBR does not know, so the
    /// registration lookup said Unregistered and every bill was refused
    /// <c>[0205]</c>; sending the letter form verbatim is refused <c>[0002]</c>
    /// "not in proper format". Both proven against the sandbox. What FBR accepts
    /// for such a buyer is the person's 13-digit CNIC.
    ///
    /// So this is the ONE rule, used by pre-flight, the payload and the challan
    /// readiness gate: a plain numeric NTN files as its 7 digits; a
    /// letter-prefixed NTN cannot be filed and the buyer's CNIC must stand in
    /// for it; a CNIC alone files as its 13 digits.
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

        /// <summary>"A113680-1", "C650414-2": an NTN IRIS knows but the invoice API refuses.</summary>
        public static bool IsLetterPrefixed(string? ntn)
            => !string.IsNullOrWhiteSpace(ntn) && ntn.Any(char.IsLetter);

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
                if (hasCnic) return (cnicDigits, null);
                if (!registered) return ("", null);
                return ("", $"Buyer NTN '{ntn!.Trim()}' has a letter prefix, which FBR's invoice API does not accept " +
                            "([0002] not in proper format) and whose digits alone FBR does not recognise ([0205]). " +
                            "Enter the buyer's 13-digit CNIC on the client record; FBR files such a buyer under it.");
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
