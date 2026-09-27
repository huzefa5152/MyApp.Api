using System.Text;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// A word and its box on the page. PDF words (PdfPig) are in PDF space, where
    /// Y grows UPWARD; OCR words (tesseract) are in image space, where it grows
    /// DOWNWARD — <see cref="PoLayoutText"/> is told which.
    /// </summary>
    public record PositionedWord(string Text, double Left, double Right, double Top, double Bottom, double Width, double Height,
        double Confidence = 100);

    /// <summary>
    /// The ONE rule that turns positioned words into the text the PO format
    /// matcher and <c>RuleBasedPOParser</c> read: words grouped into lines, each
    /// line ordered left to right, and TWO spaces where the gap to the previous
    /// word is wider than ~1.8 of its characters — the column boundary the
    /// parser splits on. A PDF and a photo of the same PO therefore produce text
    /// of the same shape, and so match the same saved format.
    ///
    /// Line grouping differs by source, deliberately:
    /// <list type="bullet">
    /// <item><see cref="FromPdfPage"/> is the rule POParserService has always
    /// used — words whose BOTTOM edges are within 0.4 x the average word height
    /// — kept byte-for-byte so no saved format's text moves.</item>
    /// <item><see cref="FromOcrPage"/> groups by vertical CENTRE: a word joins a
    /// line when its centre lies inside that line's first word's box. OCR boxes
    /// of one visual line vary in height (a two-line header cell, a tall glyph),
    /// so their bottoms scatter and the PDF rule split the table header across
    /// lines, which left the parser without a header row.</item>
    /// </list>
    /// </summary>
    public static class PoLayoutText
    {
        /// <summary>Lines of one PDF page (PDF space: larger Y is higher on the page).</summary>
        public static List<string> FromPdfPage(IReadOnlyList<PositionedWord> words)
        {
            var lines = new List<string>();
            if (words.Count == 0) return lines;

            var avgHeight = words.Average(w => w.Height);
            var yTolerance = Math.Max(avgHeight * 0.4, 2);

            var lineGroups = new List<(double Y, List<PositionedWord> Words)>();
            foreach (var word in words)
            {
                var wordY = word.Bottom;
                bool added = false;
                for (int i = 0; i < lineGroups.Count; i++)
                {
                    if (Math.Abs(wordY - lineGroups[i].Y) <= yTolerance)
                    {
                        lineGroups[i].Words.Add(word);
                        added = true;
                        break;
                    }
                }
                if (!added) lineGroups.Add((wordY, new List<PositionedWord> { word }));
            }

            // Top to bottom: higher Y = higher on the page in PDF coordinates.
            lineGroups.Sort((a, b) => b.Y.CompareTo(a.Y));
            foreach (var (_, lineWords) in lineGroups) AddLine(lines, lineWords);
            return lines;
        }

        /// <summary>Lines of one OCR'd image (image space: larger Y is LOWER on the page).</summary>
        public static List<string> FromOcrPage(IReadOnlyList<PositionedWord> words)
        {
            var lines = new List<string>();
            if (words.Count == 0) return lines;

            var kept = Deskew(words.Where(w => !IsGridDebris(w.Text) && !IsLowConfidenceFragment(w)).ToList());
            var groups = new List<(double Top, double Bottom, List<PositionedWord> Words)>();
            foreach (var word in kept.OrderBy(w => (w.Top + w.Bottom) / 2))
            {
                var centre = (word.Top + word.Bottom) / 2;
                int hit = -1;
                for (int i = 0; i < groups.Count; i++)
                    if (centre >= groups[i].Top && centre <= groups[i].Bottom) { hit = i; break; }
                if (hit >= 0) groups[hit].Words.Add(word);
                else groups.Add((word.Top, word.Bottom, new List<PositionedWord> { word }));
            }

            foreach (var g in groups.OrderBy(g => (g.Top + g.Bottom) / 2)) AddLine(lines, g.Words);
            return lines;
        }

        // A photo is never quite square to the page: at 1.2 degrees the right
        // edge of a PO sits ~30px below the left, most of a table row, so one
        // row's cells land in different lines and the parser finds no items.
        // The tilt is measured from the words themselves (a projection
        // profile: the slope at which word centres pile up into the fewest,
        // sharpest rows) and taken out before lines are grouped. A square
        // photo or a scan measures zero and passes through untouched.
        private const double MaxSkewSlope = 0.09;    // ~5 degrees either way
        private const double SkewSlopeStep = 0.0005;

        private static List<PositionedWord> Deskew(List<PositionedWord> words)
        {
            if (words.Count < 8) return words;
            var heights = words.Select(w => w.Bottom - w.Top).Where(h => h > 0).OrderBy(h => h).ToList();
            if (heights.Count == 0) return words;
            var bin = Math.Max(heights[heights.Count / 2] * 0.25, 1);
            var xMid = words.Average(w => (w.Left + w.Right) / 2);

            double Score(double slope)
            {
                var counts = new Dictionary<long, int>();
                foreach (var w in words)
                {
                    var y = (w.Top + w.Bottom) / 2 - ((w.Left + w.Right) / 2 - xMid) * slope;
                    var k = (long)Math.Floor(y / bin);
                    counts[k] = counts.GetValueOrDefault(k) + 1;
                }
                return counts.Values.Sum(c => (double)c * c);
            }

            var level = Score(0);
            double best = 0, bestScore = level;
            for (var s = -MaxSkewSlope; s <= MaxSkewSlope + 1e-12; s += SkewSlopeStep)
            {
                var score = Score(s);
                if (score > bestScore || (score == bestScore && Math.Abs(s) < Math.Abs(best))) { bestScore = score; best = s; }
            }
            // Only a clearly sharper profile moves anything: noise must not tilt a square page.
            if (best == 0 || bestScore < level * 1.05) return words;

            return words.Select(w =>
            {
                var dy = -((w.Left + w.Right) / 2 - xMid) * best;
                return w with { Top = w.Top + dy, Bottom = w.Bottom + dy };
            }).ToList();
        }

        // A table's ruling lines, read by OCR as "|", "~~", "__", "[" … An extra
        // cell made of them shifts every column after it, so the header and the
        // data rows stop lining up. A lone "-" is kept: it is a real cell value
        // (an empty Remarks column prints "-").
        private static bool IsGridDebris(string text) =>
            !string.IsNullOrWhiteSpace(text) && text.All(c => "|~_[]{}=¦".Contains(c));

        // A dotted rule under a table row reads as a run of short, faint
        // "words" ("omm mmm kiss eee ARTs", 0-41% confident) that land in the
        // item description. Real words either read well above this or carry a
        // digit ("50X15" can read at 15% and must stay). So a word goes only
        // when it is ALL of: faint, short, digit-free and has a letter. The
        // letter test keeps an empty column's faint "-" or ".": dropping it
        // would remove a cell and shift every column after it.
        private const double FragmentConfidenceFloor = 45;
        private const int FragmentMaxLength = 5;

        private static bool IsLowConfidenceFragment(PositionedWord w)
        {
            var t = w.Text.Trim();
            return w.Confidence < FragmentConfidenceFloor && t.Length <= FragmentMaxLength
                && t.Any(char.IsLetter) && !t.Any(char.IsDigit);
        }

        private static void AddLine(List<string> lines, List<PositionedWord> lineWords)
        {
            var sorted = lineWords.OrderBy(w => w.Left).ToList();
            var sb = new StringBuilder();
            for (int wi = 0; wi < sorted.Count; wi++)
            {
                if (wi > 0)
                {
                    // Use the actual gap between words to decide spacing: wider
                    // than ~2 characters is a column boundary -> double space.
                    var gap = sorted[wi].Left - sorted[wi - 1].Right;
                    var prevCharWidth = sorted[wi - 1].Width / Math.Max(sorted[wi - 1].Text.Length, 1);
                    sb.Append(gap > prevCharWidth * 1.8 ? "  " : " ");
                }
                sb.Append(sorted[wi].Text);
            }
            var text = sb.ToString();
            if (!string.IsNullOrWhiteSpace(text)) lines.Add(text);
        }
    }
}
