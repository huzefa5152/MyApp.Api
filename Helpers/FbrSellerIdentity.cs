using System.Linq;
using MyApp.Api.Models;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// The registration number a SELLER files under — the ONE place
    /// <c>sellerNTNCNIC</c> is decided.
    ///
    /// FBR takes either form, and which one a business uses is decided by how it
    /// is registered in IRIS: some log in with an NTN, others with a CNIC.
    /// Proven against the sandbox on 2026-09-14 for R &amp; R Engineering
    /// (Private) Limited, NTN 5326972, CNIC deliberately left empty:
    /// <c>validateinvoicedata_sb</c> answered HTTP 200 / "Validated" with
    /// <c>sellerNTNCNIC</c> carrying the seven-digit NTN. So a CNIC is NOT
    /// required to file — the UI used to insist on one, which locked out every
    /// NTN-registered seller.
    ///
    /// This mirrors <see cref="FbrBuyerIdentity"/> deliberately: same two forms,
    /// same 7-character NTN rule (letter kept, check digit dropped), same
    /// 13-digit CNIC. Before this existed the seller rule was written out twice
    /// inside <c>FbrService</c> — once for the pre-flight, once for the payload —
    /// and BOTH stripped letters, so a letter-prefixed NTN like Alpha's
    /// <c>D363483-0</c> would have filed as <c>3634830</c>: a different number
    /// FBR reads as unregistered. That never surfaced only because those
    /// companies also carry a CNIC, which wins. Clearing the CNIC would have
    /// exposed it.
    ///
    /// WHY CNIC WINS when both are present: it is the behaviour every currently
    /// configured company already files under, and changing which number a live
    /// seller submits as is not a refactor. A company that should file under its
    /// NTN clears the CNIC — which the UI now allows.
    /// </summary>
    public static class FbrSellerIdentity
    {
        /// <summary>
        /// What this company will file as, or the reason it cannot file at all.
        ///
        /// <paramref name="cnic"/> wins when it holds 13 digits. Otherwise the
        /// NTN is reduced the same way a buyer's is: a letter-prefixed NTN keeps
        /// its letter (<c>A113680-1</c> → <c>A113680</c>), a numeric one files as
        /// its first seven digits.
        /// </summary>
        public static (string Value, string? Error) Resolve(string? ntn, string? cnic, string? explicitValue)
        {
            // An operator-stated value wins outright. The General tab holds the
            // full legal number as IRIS issues it (5326972-8, or A113680-1 with
            // its letter); this is the seven characters — or the 13-digit CNIC —
            // that business actually files under, which nothing can derive
            // because a company may hold both and log into IRIS with either.
            var stated = (explicitValue ?? "").Trim();
            if (stated.Length > 0)
            {
                var statedDigits = FbrBuyerIdentity.Digits(stated);
                if (statedDigits.Length == 13) return (statedDigits, null);

                var core = new string(stated.Where(char.IsLetterOrDigit).ToArray()).ToUpperInvariant();
                if (core.Length == 7) return (core, null);

                return ("", $"The FBR seller NTN/CNIC \"{stated}\" is {core.Length} character(s). "
                          + "FBR files a 7-character NTN (no check digit) or a 13-digit CNIC. "
                          + "Correct it on the company's FBR Integration tab.");
            }

            var cnicDigits = FbrBuyerIdentity.Digits(cnic);
            if (cnicDigits.Length == 13) return (cnicDigits, null);

            // A part-typed CNIC is a mistake worth naming rather than silently
            // falling through to the NTN and filing under a different number.
            if (cnicDigits.Length > 0 && !HasUsableNtn(ntn))
                return ("", $"The company CNIC has {cnicDigits.Length} digits; a CNIC is 13. "
                          + "Correct it, or clear it and set the company's 7-digit NTN instead.");

            if (FbrBuyerIdentity.IsLetterPrefixed(ntn))
            {
                var letterNtn = FbrBuyerIdentity.SanitizeLetterNtn(ntn);
                if (letterNtn.Length == 7) return (letterNtn, null);
                return ("", $"The company NTN \"{ntn}\" reduces to {letterNtn.Length} character(s); "
                          + "FBR files a 7-character NTN. Correct it, or set a 13-digit CNIC.");
            }

            var digits = FbrBuyerIdentity.SanitizeNtn(ntn);
            if (digits.Length == 7) return (digits, null);

            return ("", digits.Length == 0
                ? "This company has no NTN or CNIC. FBR needs one of them as sellerNTNCNIC — "
                + "set the 7-digit NTN, or the 13-digit CNIC, on the company's General tab."
                : $"The company NTN has {digits.Length} digit(s); FBR files a 7-digit NTN. "
                + "Correct it, or set a 13-digit CNIC instead.");
        }

        /// <inheritdoc cref="Resolve(string?, string?, string?)"/>
        public static (string Value, string? Error) Resolve(Company company)
            => Resolve(company?.NTN, company?.CNIC, company?.FbrSellerNtnCnic);

        /// <summary>Two-argument form, for callers with no company row.</summary>
        public static (string Value, string? Error) Resolve(string? ntn, string? cnic)
            => Resolve(ntn, cnic, null);

        /// <summary>True when this company can file at all — the test the
        /// company form and the FBR readiness gate both apply.</summary>
        public static bool CanFile(string? ntn, string? cnic, string? explicitValue = null)
            => Resolve(ntn, cnic, explicitValue).Error == null;

        /// <summary>Which of the two a company will actually file under, for
        /// screens that say so out loud rather than leaving it a mystery.
        /// "CNIC", "NTN", or "" when neither is usable.</summary>
        public static string SourceLabel(string? ntn, string? cnic, string? explicitValue = null)
        {
            if (!string.IsNullOrWhiteSpace(explicitValue))
                return FbrBuyerIdentity.Digits(explicitValue).Length == 13
                    ? "CNIC (entered on the FBR tab)" : "NTN (entered on the FBR tab)";
            if (FbrBuyerIdentity.Digits(cnic).Length == 13) return "CNIC";
            return CanFile(ntn, cnic) ? "NTN" : "";
        }

        private static bool HasUsableNtn(string? ntn)
            => FbrBuyerIdentity.IsLetterPrefixed(ntn)
                ? FbrBuyerIdentity.SanitizeLetterNtn(ntn).Length == 7
                : FbrBuyerIdentity.SanitizeNtn(ntn).Length == 7;
    }
}
