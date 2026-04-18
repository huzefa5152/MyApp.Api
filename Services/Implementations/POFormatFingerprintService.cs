using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class POFormatFingerprintService : IPOFormatFingerprintService
    {
        // A label is "1–4 title/upper-case words" followed by `:` or `#`, with
        // optional dots/spaces inside (to catch "P.O No:", "Sr. No#", etc.).
        // Digits/currency tokens are excluded so the value side of the pair
        // doesn't leak into the signature.
        private static readonly Regex LabelRegex = new(
            @"(?<=^|\n|\s)([A-Z][A-Za-z][A-Za-z\.\s]{0,24}?)\s*[:#]",
            RegexOptions.Compiled | RegexOptions.Multiline);

        // Common all-caps table headers (appear on header row without trailing `:`).
        // We sniff these so two variants of the same template line up even when
        // one uses "QTY" and the other "QUANTITY".
        private static readonly Regex TableHeaderTokenRegex = new(
            @"\b(DESCRIPTION|QTY|QUANTITY|UOM|UNIT|UNITS|RATE|AMOUNT|TOTAL|SR\.?\s*NO|S\.?\s*NO|ITEM|ITEMS|HS\s*CODE|GST|TAX|NET|GROSS|DELIVERY|PO|ORDER)\b",
            RegexOptions.Compiled | RegexOptions.IgnoreCase);

        // Throw away anything that's clearly value content (long numbers, dates,
        // currency amounts). We only want the structural vocabulary.
        private static readonly HashSet<string> StopWords = new(StringComparer.OrdinalIgnoreCase)
        {
            "the", "a", "an", "of", "for", "to", "and", "or", "is", "are",
            "this", "that", "with", "by", "on", "in", "at", "as", "be",
        };

        public FingerprintResult Compute(string rawText)
        {
            if (string.IsNullOrWhiteSpace(rawText))
                return new FingerprintResult("", "", Array.Empty<string>());

            // Only look at the first ~4000 chars — that's where the template
            // boilerplate lives. The tail is line items, which vary per PO.
            var window = rawText.Length > 4000 ? rawText[..4000] : rawText;

            var keywords = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            // 1) Labeled anchors (primary signal)
            foreach (Match m in LabelRegex.Matches(window))
            {
                var label = Normalize(m.Groups[1].Value);
                if (IsMeaningfulKeyword(label))
                    keywords.Add(label);
            }

            // 2) Table header tokens (secondary signal, helps when colons are missing)
            foreach (Match m in TableHeaderTokenRegex.Matches(window))
            {
                var token = Normalize(m.Value);
                if (IsMeaningfulKeyword(token))
                    keywords.Add(token);
            }

            var sorted = keywords.OrderBy(k => k, StringComparer.Ordinal).ToList();
            var signature = string.Join("|", sorted);
            var hash = Sha256Hex(signature);

            return new FingerprintResult(hash, signature, sorted);
        }

        private static string Normalize(string input)
        {
            // Lowercase, collapse whitespace, strip trailing punctuation/colons.
            var trimmed = input.Trim().TrimEnd(':', '#', '.', ',', ';');
            trimmed = Regex.Replace(trimmed, @"\s+", " ");
            return trimmed.ToLowerInvariant();
        }

        private static bool IsMeaningfulKeyword(string token)
        {
            if (string.IsNullOrWhiteSpace(token)) return false;
            if (token.Length < 2 || token.Length > 40) return false;
            if (StopWords.Contains(token)) return false;
            // Require at least one letter — rejects stray "1234" or "17/04".
            if (!token.Any(char.IsLetter)) return false;
            return true;
        }

        private static string Sha256Hex(string input)
        {
            using var sha = SHA256.Create();
            var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(input));
            var sb = new StringBuilder(bytes.Length * 2);
            foreach (var b in bytes) sb.Append(b.ToString("x2"));
            return sb.ToString();
        }
    }
}
