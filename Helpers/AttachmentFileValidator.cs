namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Validator for the unified attachment system. Unlike
    /// <see cref="ImageUploadValidator"/> (images only), this accepts the broad
    /// enterprise document set — images, PDF, Office, text/CSV, ZIP — while
    /// still defending against the classic upload attacks:
    ///   1. Extension allowlist (executables, scripts, HTML, SVG are rejected
    ///      because they're simply absent from the list).
    ///   2. Size cap (caller-supplied, from Attachments:MaxFileBytes).
    ///   3. Magic-bytes sniff for the binary types that have a stable signature,
    ///      so a renamed .exe→.pdf doesn't slip through. Inert text formats
    ///      (.txt, .csv) have no signature and pass on extension + non-emptiness.
    ///
    /// Returns null when the file passes every check; otherwise a user-facing
    /// message describing the first violation (same contract as
    /// <see cref="ImageUploadValidator.Validate"/>).
    /// </summary>
    public static class AttachmentFileValidator
    {
        /// <summary>
        /// The allowlist. Anything not here (.exe, .js, .html, .svg, .bat, …)
        /// is rejected outright. SVG is intentionally excluded — it can carry
        /// embedded script.
        /// </summary>
        public static readonly string[] AllowedExtensions =
        {
            // images
            ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff",
            // documents
            ".pdf",
            ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
            ".txt", ".csv",
            // archives
            ".zip"
        };

        public const long DefaultMaxBytes = 25L * 1024 * 1024; // 25 MB

        public static string? Validate(IFormFile? file, long maxBytes = DefaultMaxBytes)
        {
            if (file == null || file.Length == 0)
                return "No file uploaded.";
            if (file.Length > maxBytes)
                return $"File size must be under {maxBytes / (1024 * 1024)} MB.";

            var ext = Path.GetExtension(file.FileName ?? "").ToLowerInvariant();
            if (string.IsNullOrEmpty(ext) || !AllowedExtensions.Contains(ext))
                return "This file type is not allowed. Allowed: images, PDF, Word, Excel, PowerPoint, text, CSV, and ZIP.";

            try
            {
                using var s = file.OpenReadStream();
                Span<byte> head = stackalloc byte[16];
                var read = s.Read(head);
                if (read <= 0) return "The uploaded file is empty.";
                if (!SignatureMatchesExtension(ext, head, read))
                    return "File contents do not match its extension.";
            }
            catch (Exception)
            {
                return "Could not read the uploaded file.";
            }
            return null;
        }

        /// <summary>
        /// Confirms the leading bytes are consistent with the claimed extension
        /// for types that have a reliable signature. Text-like types (.txt,
        /// .csv) pass by default — they're inert and the allowlist already
        /// gated them.
        /// </summary>
        private static bool SignatureMatchesExtension(string ext, ReadOnlySpan<byte> h, int n)
        {
            switch (ext)
            {
                case ".png":
                    return n >= 8 && h[0] == 0x89 && h[1] == 0x50 && h[2] == 0x4E && h[3] == 0x47
                        && h[4] == 0x0D && h[5] == 0x0A && h[6] == 0x1A && h[7] == 0x0A;
                case ".jpg":
                case ".jpeg":
                    return n >= 3 && h[0] == 0xFF && h[1] == 0xD8 && h[2] == 0xFF;
                case ".gif":
                    return n >= 6 && h[0] == 0x47 && h[1] == 0x49 && h[2] == 0x46 && h[3] == 0x38
                        && (h[4] == 0x37 || h[4] == 0x39) && h[5] == 0x61;
                case ".webp":
                    return n >= 12 && h[0] == 0x52 && h[1] == 0x49 && h[2] == 0x46 && h[3] == 0x46  // RIFF
                        && h[8] == 0x57 && h[9] == 0x45 && h[10] == 0x42 && h[11] == 0x50;          // WEBP
                case ".bmp":
                    return n >= 2 && h[0] == 0x42 && h[1] == 0x4D;                                  // BM
                case ".tif":
                case ".tiff":
                    return n >= 4 && ((h[0] == 0x49 && h[1] == 0x49 && h[2] == 0x2A && h[3] == 0x00)   // II*\0
                                   || (h[0] == 0x4D && h[1] == 0x4D && h[2] == 0x00 && h[3] == 0x2A)); // MM\0*
                case ".pdf":
                    return n >= 5 && h[0] == 0x25 && h[1] == 0x50 && h[2] == 0x44 && h[3] == 0x46 && h[4] == 0x2D; // %PDF-
                // OOXML (docx/xlsx/pptx) and zip are all ZIP containers: "PK".
                case ".docx":
                case ".xlsx":
                case ".pptx":
                case ".zip":
                    return n >= 2 && h[0] == 0x50 && h[1] == 0x4B;                                  // PK
                // Legacy Office (.doc/.xls/.ppt) is an OLE compound file.
                case ".doc":
                case ".xls":
                case ".ppt":
                    return n >= 8 && h[0] == 0xD0 && h[1] == 0xCF && h[2] == 0x11 && h[3] == 0xE0
                        && h[4] == 0xA1 && h[5] == 0xB1 && h[6] == 0x1A && h[7] == 0xE1;
                // Inert text formats — no reliable signature.
                case ".txt":
                case ".csv":
                    return true;
                default:
                    return false; // unreachable — extension allowlist gates first
            }
        }
    }
}
