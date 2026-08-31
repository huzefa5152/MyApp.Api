using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace MyApp.Api.Helpers.ExcelImport
{
    /// <summary>
    /// Structural fingerprint of an uploaded workbook, used to recognise a
    /// layout the operator has already mapped. The spreadsheet equivalent of
    /// <c>POFormatFingerprintService</c>, which does the same job for PO PDFs.
    ///
    /// The signature has to capture the SHAPE of the workbook and as little of
    /// its CONTENT as possible, because the same layout arrives again every
    /// month with different numbers, different dates and an extra customer or
    /// two. Three rules do most of that work:
    ///
    ///   • Digits are stripped and month names are stop-worded, so "Jul 2026"
    ///     and "Aug 2026" fingerprint alike. Digits alone are not enough — the
    ///     month NAME is letters.
    ///   • Only the first few sheets and their top rows are read — that is
    ///     where the template's header vocabulary lives. Not sheet 0 alone: a
    ///     stock workbook opens on a pivot tab and keeps its data on the next.
    ///   • A token from a sheet AFTER the first counts only if more than one of
    ///     them carries it. Those sheets are per-customer, so their headings
    ///     repeat and their customer names do not.
    ///   • DATA ROWS INSIDE THAT BAND ARE SKIPPED (see <see cref="LooksLikeData"/>).
    ///     This one matters most. A stock sheet puts its headings on row 3 and
    ///     its first products on row 4, so a naive read of the top eight rows
    ///     made half the signature out of product names — "ball", "valve",
    ///     "mould". Two months of the SAME template then scored 0.33 against
    ///     each other, below the threshold to be offered at all, and the layout
    ///     had to be re-mapped every month. Skipping numeric rows leaves the
    ///     headings alone, so the same template hashes identically month on month.
    ///   • Short tokens are dropped, which removes most stray value fragments.
    ///
    /// Some content inevitably leaks (a customer name in a header cell). That is
    /// why an exact hash miss falls back to Jaccard similarity and an operator
    /// confirmation rather than being treated as a new layout outright.
    /// </summary>
    public static class WorkbookFingerprint
    {
        /// <summary>
        /// Sheets sampled.
        ///
        /// More than one on purpose: the first sheet is NOT reliably the
        /// meaningful one. The stock workbook opens on a pivot tab and keeps its
        /// real data on the second, so reading only sheet 0 fingerprinted the
        /// summary the operator was told to ignore.
        ///
        /// Few enough that appending a per-customer sheet at the end changes
        /// nothing.
        /// </summary>
        public const int MaxSheets = 3;

        /// <summary>Rows sampled per sheet — the template's header band.</summary>
        public const int MaxRows = 8;

        /// <summary>
        /// Columns sampled per row.
        ///
        /// Wide enough to reach the amount columns: a stock sheet keeps its
        /// closing quantity and value out at columns 18 and 19, and at 15 the
        /// data check could not see them — so every data row looked like a
        /// heading row and its product names went into the signature.
        ///
        /// Not wider, though. That sheet also parks a Capital and Sales total
        /// out around column 37, and reaching those would make its TITLE row
        /// look like data and throw the business name away.
        /// </summary>
        public const int MaxCols = 25;

        private const int MinTokenLength = 3;

        /// <summary>
        /// Above this many worksheets, the workbook is taken to hold one sheet
        /// per record (a customer ledger) rather than a handful of tabs (a stock
        /// sheet with a pivot). The two need opposite treatment — see Compute.
        /// </summary>
        private const int SheetPerRecordThreshold = 5;

        /// <summary>Anything that is not a letter becomes a separator, which
        /// strips digits, punctuation and currency marks in one pass.</summary>
        private static readonly Regex NonLetter = new(@"[^\p{L}]+", RegexOptions.Compiled);

        /// <summary>
        /// Words that are date or filler content rather than structure.
        ///
        /// Month names earn their place here. Stripping digits alone normalises
        /// "2026" but leaves "Jul" and "Aug" as distinct tokens, so the same
        /// monthly workbook would fingerprint differently every month and never
        /// match its own saved layout — and these sheets are titled and tabbed
        /// by period as a matter of course.
        /// </summary>
        private static readonly HashSet<string> StopWords = new(StringComparer.OrdinalIgnoreCase)
        {
            "the", "and", "for", "with", "from", "this", "that", "sheet", "sheets",
            "january", "february", "march", "april", "may", "june", "july",
            "august", "september", "october", "november", "december",
            "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept",
            "oct", "nov", "dec",
        };

        public sealed record Result(string Hash, string TokenSignature, IReadOnlyList<string> Tokens);

        public static Result Compute(IImportedWorkbook workbook)
        {
            var tokens = new HashSet<string>(StringComparer.Ordinal);
            var sheets = Math.Min(workbook.WorksheetCount, MaxSheets);

            // Sheet 0 — the index or data sheet — contributes everything it has,
            // including its tab name. There is only one of it, so nothing can
            // corroborate it and nothing needs to.
            if (sheets > 0)
            {
                AddTokens(tokens, workbook.GetSheetName(0));
                foreach (var text in HeaderCells(workbook, 0)) AddTokens(tokens, text);
            }

            // How the remaining sheets are treated depends on what KIND of
            // workbook this is, and the tab count is what tells them apart.
            //
            // A workbook with a sheet per customer has dozens. Their header
            // bands mix the template's headings with THAT customer's name, so a
            // token only counts when more than one sheet carries it: structure
            // repeats across them, identity does not. That drops "unregister"
            // and "communication" while keeping "particulars" and "inv", which
            // is what lets a ledger recognise itself after its customer list has
            // completely turned over.
            //
            // A workbook with a couple of tabs is the opposite case — the stock
            // sheet opens on a pivot and keeps its data on sheet 1, so there is
            // nothing to corroborate against and demanding corroboration would
            // throw the only real headings away.
            var perCustomerWorkbook = workbook.WorksheetCount > SheetPerRecordThreshold;

            var seen = new Dictionary<string, int>(StringComparer.Ordinal);
            for (int sheet = 1; sheet < sheets; sheet++)
            {
                var perSheet = new HashSet<string>(StringComparer.Ordinal);
                foreach (var text in HeaderCells(workbook, sheet)) AddTokens(perSheet, text);

                if (!perCustomerWorkbook) { foreach (var t in perSheet) tokens.Add(t); continue; }

                foreach (var token in perSheet)
                    seen[token] = seen.GetValueOrDefault(token) + 1;
            }
            foreach (var (token, count) in seen)
                if (count >= 2) tokens.Add(token);

            var sorted = tokens.OrderBy(t => t, StringComparer.Ordinal).ToList();
            var signature = string.Join("|", sorted);
            return new Result(Sha256Hex(signature), signature, sorted);
        }

        /// <summary>Text of the header band on one sheet, data rows skipped.</summary>
        private static IEnumerable<string> HeaderCells(IImportedWorkbook workbook, int sheet)
        {
            var lastRow = Math.Min(workbook.GetLastRow(sheet), MaxRows);
            for (int row = 1; row <= lastRow; row++)
            {
                if (LooksLikeData(workbook, sheet, row)) continue;
                for (int col = 1; col <= MaxCols; col++)
                    yield return workbook.GetString(sheet, row, col);
            }
        }

        /// <summary>
        /// A row carrying values rather than labels. Two or more numeric cells
        /// is the test: a heading row is words, and a one-off year or sequence
        /// number in an otherwise textual row should not disqualify it.
        /// </summary>
        private static bool LooksLikeData(IImportedWorkbook workbook, int sheet, int row)
        {
            var numeric = 0;
            for (int col = 1; col <= MaxCols; col++)
            {
                if (string.IsNullOrWhiteSpace(workbook.GetString(sheet, row, col))) continue;
                if (workbook.GetDecimal(sheet, row, col).HasValue && ++numeric >= 2) return true;
            }
            return false;
        }

        private static void AddTokens(HashSet<string> into, string? text)
        {
            if (string.IsNullOrWhiteSpace(text)) return;

            foreach (var raw in NonLetter.Split(text))
            {
                if (raw.Length < MinTokenLength) continue;
                var token = raw.ToLowerInvariant();
                if (StopWords.Contains(token)) continue;
                into.Add(token);
            }
        }

        /// <summary>
        /// Overlap between two pipe-delimited signatures, 0..1. Used to offer a
        /// near-match for confirmation when no hash matches exactly — a workbook
        /// that gained one header cell should suggest its existing profile, not
        /// force the operator to map it again from scratch.
        /// </summary>
        public static double Similarity(string? signatureA, string? signatureB)
        {
            var a = Split(signatureA);
            var b = Split(signatureB);
            if (a.Count == 0 || b.Count == 0) return 0d;

            var intersection = a.Count(b.Contains);
            var union = a.Count + b.Count - intersection;
            return union == 0 ? 0d : (double)intersection / union;
        }

        private static HashSet<string> Split(string? signature) =>
            string.IsNullOrWhiteSpace(signature)
                ? new HashSet<string>(StringComparer.Ordinal)
                : new HashSet<string>(
                    signature.Split('|', StringSplitOptions.RemoveEmptyEntries),
                    StringComparer.Ordinal);

        private static string Sha256Hex(string input)
        {
            using var sha = SHA256.Create();
            return Convert.ToHexString(sha.ComputeHash(Encoding.UTF8.GetBytes(input))).ToLowerInvariant();
        }
    }
}
