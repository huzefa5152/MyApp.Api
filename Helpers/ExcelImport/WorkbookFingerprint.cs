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
    ///   • Digits are stripped, so "Jul 2026" and "Aug 2026" fingerprint alike.
    ///   • Only the first few sheets and their top rows are read — that is where
    ///     the template's header vocabulary lives; everything below is data.
    ///   • Short tokens are dropped, which removes most stray value fragments.
    ///
    /// Some content inevitably leaks (a customer name in a header cell). That is
    /// why an exact hash miss falls back to Jaccard similarity and an operator
    /// confirmation rather than being treated as a new layout outright.
    /// </summary>
    public static class WorkbookFingerprint
    {
        /// <summary>Sheets sampled. Enough to see an index sheet plus a couple of
        /// detail sheets; few enough that appending a new per-customer sheet at
        /// the end does not change the hash.</summary>
        public const int MaxSheets = 3;

        /// <summary>Rows sampled per sheet — the template's header band.</summary>
        public const int MaxRows = 8;

        /// <summary>Columns sampled per row.</summary>
        public const int MaxCols = 15;

        private const int MinTokenLength = 3;

        /// <summary>Anything that is not a letter becomes a separator, which
        /// strips digits, punctuation and currency marks in one pass.</summary>
        private static readonly Regex NonLetter = new(@"[^\p{L}]+", RegexOptions.Compiled);

        private static readonly HashSet<string> StopWords = new(StringComparer.OrdinalIgnoreCase)
        {
            "the", "and", "for", "with", "from", "this", "that", "sheet", "sheets",
        };

        public sealed record Result(string Hash, string TokenSignature, IReadOnlyList<string> Tokens);

        public static Result Compute(IImportedWorkbook workbook)
        {
            var tokens = new HashSet<string>(StringComparer.Ordinal);

            var sheets = Math.Min(workbook.WorksheetCount, MaxSheets);
            for (int sheet = 0; sheet < sheets; sheet++)
            {
                // The first sheet's NAME is structural ("Chart Of Acount",
                // "Jul 2026"). Later sheet names are usually customer names, so
                // they are data and stay out of the signature.
                if (sheet == 0)
                    AddTokens(tokens, workbook.GetSheetName(sheet));

                var lastRow = Math.Min(workbook.GetLastRow(sheet), MaxRows);
                for (int row = 1; row <= lastRow; row++)
                    for (int col = 1; col <= MaxCols; col++)
                        AddTokens(tokens, workbook.GetString(sheet, row, col));
            }

            var sorted = tokens.OrderBy(t => t, StringComparer.Ordinal).ToList();
            var signature = string.Join("|", sorted);
            return new Result(Sha256Hex(signature), signature, sorted);
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
