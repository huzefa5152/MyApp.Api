using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>An incoming PO's fuzzy-match keywords: layout, and labels found on item rows.</summary>
    public record MatchKeywords(HashSet<string> Layout, HashSet<string> ItemRows);

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

        // ── Keywords for FUZZY matching ─────────────────────────────────────
        // Compute() above is the stored signature and its exact-match hash, and
        // must not change: every saved format's SignatureHash was computed with
        // it. Fuzzy matching instead compares these two cleaned-up sets, which
        // drop two kinds of DATA that Compute lets in as "labels":
        //   - text on item rows ("…SUPER EPOXY RESIN:  SET  4  4800.00",
        //     "1000gm HARDENER: 800gm") — the table's contents vary per PO;
        //   - a time-of-day token glued in front of a label ("10:51 AM  Head
        //     Office :" -> "am head office", on another PO "pm head office").
        // Both made the same Meko layout score 0.67 against its own format.

        // The item table's header line: three or more header tokens, one of
        // them a quantity. Top-of-page lines ("PO Type : GST", "Delivery
        // Location") carry header words too, but never a quantity column.
        private static readonly Regex QuantityTokenRegex = new(@"\b(QTY|QUANTITY)\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);

        // Where the item table ends: a totals line.
        private static readonly Regex TableEndRegex = new(
            @"^\s*(?:Sub-?\s*Total|Subtotal|Grand\s+Total|Total|Net\s+(?:Amount|Total|Payable)|Sales\s+Tax|Discount|Freight)\b",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        private static readonly Regex TimePrefixRegex = new(@"^(?:am|pm)\s+", RegexOptions.Compiled);

        /// <summary>A keyword as fuzzy matching compares it (stored or incoming).</summary>
        public static string NormaliseForMatch(string keyword) =>
            TimePrefixRegex.Replace((keyword ?? "").Trim().ToLowerInvariant(), "");

        /// <summary>A saved format's signature as fuzzy matching compares it.</summary>
        public static HashSet<string> StoredMatchKeywords(string? signature) =>
            new((signature ?? "").Split('|', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .Select(NormaliseForMatch)
                    .Where(k => k.Length > 0),
                StringComparer.OrdinalIgnoreCase);

        /// <summary>
        /// An incoming PO's keywords for fuzzy matching, in two parts: the layout
        /// keywords, and the "labels" that sit on item rows (see
        /// <see cref="MatchScore"/> for how each part counts). Same extraction as
        /// <see cref="Compute"/>, every keyword through <see cref="NormaliseForMatch"/>.
        /// </summary>
        public static MatchKeywords ComputeMatchKeywords(string rawText)
        {
            var layout = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var itemRows = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (string.IsNullOrWhiteSpace(rawText)) return new MatchKeywords(layout, itemRows);
            var window = rawText.Length > 4000 ? rawText[..4000] : rawText;
            var (tableStart, tableEnd) = FindItemTable(window);

            foreach (Match m in LabelRegex.Matches(window))
            {
                var label = NormaliseForMatch(Normalize(m.Groups[1].Value));
                if (!IsMeaningfulKeyword(label)) continue;
                if (m.Index >= tableStart && m.Index < tableEnd) itemRows.Add(label);
                else layout.Add(label);
            }
            foreach (Match m in TableHeaderTokenRegex.Matches(window))
            {
                var token = NormaliseForMatch(Normalize(m.Value));
                if (IsMeaningfulKeyword(token)) layout.Add(token);
            }
            itemRows.ExceptWith(layout);
            return new MatchKeywords(layout, itemRows);
        }

        /// <summary>
        /// Jaccard similarity of an incoming PO to a saved format. An item-row
        /// label counts only when the saved signature has it too: a saved
        /// signature may itself carry labels from its sample's item rows (it was
        /// computed by <see cref="Compute"/>), so dropping them from the incoming
        /// side would cost real overlap — but one this PO's own item text
        /// introduced ("SUPER EPOXY RESIN") never counts against it. A score can
        /// therefore only rise against the old whole-set Jaccard, never fall.
        /// </summary>
        public static double MatchScore(MatchKeywords incoming, HashSet<string> stored)
        {
            var a = new HashSet<string>(incoming.Layout, StringComparer.OrdinalIgnoreCase);
            foreach (var k in incoming.ItemRows)
                if (stored.Contains(k)) a.Add(k);
            if (a.Count == 0 && stored.Count == 0) return 0;
            var inter = a.Count(stored.Contains);
            var union = a.Count + stored.Count - inter;
            return union == 0 ? 0 : (double)inter / union;
        }

        /// <summary>
        /// Character span of the item rows: from the line after the table header
        /// to the first totals line. (-1, -1) when no header line is found, so
        /// nothing is excluded.
        /// </summary>
        private static (int Start, int End) FindItemTable(string text)
        {
            int pos = 0, start = -1;
            foreach (var line in text.Split('\n'))
            {
                var lineStart = pos;
                pos += line.Length + 1;
                if (start < 0)
                {
                    var tokens = TableHeaderTokenRegex.Matches(line)
                        .Select(m => m.Value.ToUpperInvariant()).Distinct().Count();
                    if (tokens >= 3 && QuantityTokenRegex.IsMatch(line)) start = pos;
                    continue;
                }
                if (TableEndRegex.IsMatch(line)) return (start, lineStart);
            }
            return start < 0 ? (-1, -1) : (start, text.Length);
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
