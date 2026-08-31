using System.Security.Cryptography;
using MyApp.Api.Helpers.ExcelImport;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Layered validation for an uploaded spreadsheet, in the shape of
    /// <see cref="ImageUploadValidator"/>: cheapest reject first, and nothing is
    /// parsed until the bytes have been proved to be a workbook.
    ///
    /// The layering is not ceremony. Handing a renamed PDF straight to ClosedXML
    /// throws from deep inside the zip reader, and the operator sees an internal
    /// exception instead of "that is not an Excel file". Every check below exists
    /// to turn one such failure into a sentence someone can act on.
    ///
    /// Checks, in order:
    ///   1. Present and non-empty.
    ///   2. Within the size cap.
    ///   3. Extension on the allowlist.
    ///   4. Magic bytes match a known workbook container.
    ///   5. Container agrees with the extension — a .xls renamed .xlsx passes
    ///      3 and 4 independently and only fails later, unreadably.
    ///   6. Opens, has a worksheet, and has at least one non-empty cell.
    /// </summary>
    public static class ExcelUploadValidator
    {
        /// <summary>10 MB. Alpha Traders' 66-sheet ledger is 275 KB; a workbook
        /// carrying embedded images runs larger. Higher than the 5 MB client
        /// importer because this endpoint is admin-gated.</summary>
        public const long MaxBytes = 10 * 1024 * 1024;

        public static readonly string[] AllowedExtensions = { ".xls", ".xlsx", ".xlsm" };

        /// <summary>ZIP local file header — the container for .xlsx / .xlsm.</summary>
        private static readonly byte[] ZipSignature = { 0x50, 0x4B, 0x03, 0x04 };

        /// <summary>OLE2 compound file — the container for legacy .xls.</summary>
        private static readonly byte[] Ole2Signature = { 0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1 };

        /// <summary>
        /// Validated upload. <see cref="Error"/> non-null means every other
        /// member is meaningless — check it first.
        /// </summary>
        public sealed record Result(
            string? Error,
            byte[] Bytes,
            string Sha256,
            string Extension,
            string FileName)
        {
            public bool Ok => Error == null;

            public static Result Fail(string message) =>
                new(message, Array.Empty<byte>(), "", "", "");
        }

        /// <summary>
        /// Runs every check and buffers the file. The bytes are needed twice —
        /// once to hash, once to parse — and the size cap keeps that safe to hold
        /// in memory rather than round-tripping through a temp file.
        /// </summary>
        public static async Task<Result> ValidateAsync(IFormFile? file, CancellationToken ct = default)
        {
            if (file == null || file.Length == 0)
                return Result.Fail("Choose a file to import.");

            if (file.Length > MaxBytes)
                return Result.Fail($"That file is too large ({MaxBytes / (1024 * 1024)} MB maximum).");

            var name = file.FileName ?? "upload.xlsx";
            var ext = Path.GetExtension(name).ToLowerInvariant();

            if (!AllowedExtensions.Contains(ext) || !WorkbookReaderFactory.IsSupported(ext))
                return Result.Fail("Upload an Excel workbook (.xls, .xlsx or .xlsm).");

            byte[] bytes;
            try
            {
                using var buffer = new MemoryStream();
                await using (var source = file.OpenReadStream())
                    await source.CopyToAsync(buffer, ct);
                bytes = buffer.ToArray();
            }
            catch (OperationCanceledException) { throw; }
            catch
            {
                return Result.Fail("The uploaded file could not be read. Please try again.");
            }

            // Re-check after buffering: IFormFile.Length is client-declared, and
            // a stream that lies about its length would otherwise slip the cap.
            if (bytes.Length == 0)
                return Result.Fail("Choose a file to import.");
            if (bytes.Length > MaxBytes)
                return Result.Fail($"That file is too large ({MaxBytes / (1024 * 1024)} MB maximum).");

            var isZip = StartsWith(bytes, ZipSignature);
            var isOle2 = StartsWith(bytes, Ole2Signature);

            if (!isZip && !isOle2)
                return Result.Fail("That file is not a valid Excel workbook.");

            // A container/extension mismatch is its own message. Telling the
            // operator "not a valid workbook" when the file IS a workbook, just
            // misnamed, sends them looking for the wrong problem.
            if (ext == ".xls" && !isOle2)
                return Result.Fail("The file contents do not match its .xls extension. Re-save it as .xlsx and try again.");
            if (ext is ".xlsx" or ".xlsm" && !isZip)
                return Result.Fail($"The file contents do not match its {ext} extension. It looks like a legacy .xls — rename it and try again.");

            var readable = TryReadStructure(bytes, ext);
            if (readable != null)
                return Result.Fail(readable);

            return new Result(null, bytes, Sha256Hex(bytes), ext, name);
        }

        /// <summary>
        /// Opens the workbook and proves it holds something. Returns null when
        /// fine, otherwise the operator-facing reason. A workbook that opens but
        /// is entirely blank is a real case — an operator picking the wrong file
        /// from a template folder — and it must not reach the mapping step,
        /// where it would present as "no columns found".
        /// </summary>
        private static string? TryReadStructure(byte[] bytes, string extension)
        {
            try
            {
                using var stream = new MemoryStream(bytes, writable: false);
                using var wb = WorkbookReaderFactory.Open(stream, extension);

                if (wb.WorksheetCount <= 0)
                    return "That workbook has no worksheets.";

                for (int sheet = 0; sheet < wb.WorksheetCount; sheet++)
                {
                    var lastRow = Math.Min(wb.GetLastRow(sheet), 50);
                    for (int row = 1; row <= lastRow; row++)
                        for (int col = 1; col <= 30; col++)
                            if (!string.IsNullOrWhiteSpace(wb.GetString(sheet, row, col)))
                                return null;
                }

                return "That workbook is empty.";
            }
            catch
            {
                // Deliberately not surfacing the reader's exception text — it
                // names internal zip/OLE structures and helps nobody.
                return "That workbook could not be read. It may be corrupt or password-protected.";
            }
        }

        private static bool StartsWith(byte[] bytes, byte[] signature)
        {
            if (bytes.Length < signature.Length) return false;
            for (int i = 0; i < signature.Length; i++)
                if (bytes[i] != signature[i]) return false;
            return true;
        }

        public static string Sha256Hex(byte[] bytes)
        {
            using var sha = SHA256.Create();
            return Convert.ToHexString(sha.ComputeHash(bytes)).ToLowerInvariant();
        }
    }
}
