using System.Globalization;

namespace MyApp.Api.Helpers.ExcelImport
{
    /// <summary>
    /// Parses the TEXT form of a numeric cell — the fallback both workbook
    /// readers reach for when a cell is not stored as a number.
    ///
    /// It exists because a real accountant's sheet mixes the two. On the
    /// customs-lot stock sheets, the sales-tax rate column is numeric 0.18 on
    /// 118 rows and the literal string <c>18%</c> on two of them (someone typed
    /// over the formula). A plain <c>decimal.TryParse</c> rejects the string, so
    /// those rows came back with no rate at all — and because a merged item's
    /// rate is weighted by value, ONE such row dragged a whole HS code's rate
    /// from 18% to 14.74%. Nothing looked broken: the figure was plausible, and
    /// the tax was understated by 115,270.18 on a single import.
    ///
    /// So a trailing percent sign is honoured rather than ignored: "18%" is
    /// eighteen percent, i.e. 0.18, which is exactly what the numeric cells in
    /// that column hold.
    /// </summary>
    public static class CellNumber
    {
        /// <summary>
        /// Reads a number out of a cell's displayed text. Returns null when the
        /// text is not a number at all — a heading, a dash, a note.
        /// </summary>
        public static decimal? Parse(string? text)
        {
            if (string.IsNullOrWhiteSpace(text)) return null;

            var s = text.Trim();

            // Accounting formats show a negative in brackets.
            var negative = false;
            if (s.Length > 1 && s[0] == '(' && s[^1] == ')')
            {
                negative = true;
                s = s[1..^1].Trim();
            }

            // A percent-formatted cell displays 0.18 as "18%". Read it back as
            // the fraction the numeric cells in the same column carry, so the
            // caller's fraction-or-percentage handling stays the only place
            // that decision is made.
            var percent = s.EndsWith('%');
            if (percent) s = s[..^1].TrimEnd();

            s = s.Replace(",", "").Trim();
            if (s.Length == 0) return null;

            if (!decimal.TryParse(s, NumberStyles.Any, CultureInfo.InvariantCulture, out var d))
                return null;

            if (percent) d /= 100m;
            return negative ? -d : d;
        }
    }
}
