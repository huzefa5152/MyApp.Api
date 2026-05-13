namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Audit H-3 / M-7 (2026-05-13): shared upload validator for company
    /// logos and user avatars. Pre-fix the company-logo endpoint had no
    /// validation at all (any extension, any MIME), and the avatar one
    /// did extension-only — an operator could drop in a .svg with an
    /// embedded script or rename .html to .png and the server happily
    /// served it back.
    ///
    /// Layered checks (each MUST pass):
    ///   1. Extension allowlist (cheap reject for obvious wrong files).
    ///   2. Size cap.
    ///   3. Magic-bytes sniff against known image signatures so renames
    ///      don't get through.
    /// </summary>
    public static class ImageUploadValidator
    {
        public static readonly string[] AllowedExtensions = { ".jpg", ".jpeg", ".png", ".webp", ".gif" };

        public const int DefaultMaxBytes = 2 * 1024 * 1024;   // avatars
        public const int LogoMaxBytes    = 5 * 1024 * 1024;   // logos a bit larger

        /// <summary>
        /// Returns null when the file passes every check; otherwise a
        /// user-facing error message describing the first violation.
        /// </summary>
        public static string? Validate(IFormFile? file, int maxBytes = DefaultMaxBytes)
        {
            if (file == null || file.Length == 0)
                return "No file uploaded.";
            if (file.Length > maxBytes)
                return $"File size must be under {maxBytes / (1024 * 1024)} MB.";

            var ext = Path.GetExtension(file.FileName ?? "").ToLowerInvariant();
            if (!AllowedExtensions.Contains(ext))
                return "Only JPG, PNG, WebP, and GIF images are allowed.";

            try
            {
                using var s = file.OpenReadStream();
                Span<byte> head = stackalloc byte[12];
                var read = s.Read(head);
                if (read < 4) return "File is too small to be a valid image.";
                if (!LooksLikeImage(head, read))
                    return "File contents do not match a known image format.";
            }
            catch (Exception ex)
            {
                return "Could not read the uploaded file: " + ex.Message;
            }
            return null;
        }

        /// <summary>
        /// Magic-bytes check against PNG, JPEG, GIF, WebP. False positives
        /// here would let a malformed file through, but the downstream
        /// browser still won't execute it (Content-Type stays image/*).
        /// </summary>
        private static bool LooksLikeImage(ReadOnlySpan<byte> head, int read)
        {
            // PNG: 89 50 4E 47 0D 0A 1A 0A
            if (read >= 8
                && head[0] == 0x89 && head[1] == 0x50 && head[2] == 0x4E && head[3] == 0x47
                && head[4] == 0x0D && head[5] == 0x0A && head[6] == 0x1A && head[7] == 0x0A)
                return true;

            // JPEG: FF D8 FF
            if (read >= 3 && head[0] == 0xFF && head[1] == 0xD8 && head[2] == 0xFF)
                return true;

            // GIF87a / GIF89a: 47 49 46 38 (7|9) 61
            if (read >= 6 && head[0] == 0x47 && head[1] == 0x49 && head[2] == 0x46 && head[3] == 0x38
                && (head[4] == 0x37 || head[4] == 0x39) && head[5] == 0x61)
                return true;

            // WebP: "RIFF" .... "WEBP"
            if (read >= 12
                && head[0] == 0x52 && head[1] == 0x49 && head[2] == 0x46 && head[3] == 0x46
                && head[8] == 0x57 && head[9] == 0x45 && head[10] == 0x42 && head[11] == 0x50)
                return true;

            return false;
        }
    }
}
