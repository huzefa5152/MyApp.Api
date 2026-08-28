using System.Text.RegularExpressions;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Path rules for per-line product images on a Sales Quote.
    ///
    /// The files live under <c>data/uploads/quoteitems/company_{id}/</c> and are
    /// served by the PUBLIC /data static provider — same class as the company
    /// logo and print stamps (<see cref="Models.CompanyStamp"/>). That's load-bearing:
    /// the print popup renders the image with a plain <c>&lt;img src&gt;</c>, which
    /// cannot carry an Authorization header. Names are GUIDs so the directory
    /// isn't enumerable.
    ///
    /// Because the stored value arrives from the client on save, it must be
    /// validated against the quote's OWN company folder — otherwise a forged
    /// body could point a line at another tenant's image, or at an external URL
    /// that phones home when the customer opens the printed quote.
    /// </summary>
    public static class QuoteLineImages
    {
        public const string RootRelDir = "data/uploads/quoteitems";

        /// <summary>Max stored length of the relative URL (matches the column).</summary>
        public const int MaxUrlLength = 300;

        // /data/uploads/quoteitems/company_12/8f3c….png — nothing else passes.
        private static readonly Regex UrlPattern = new(
            @"^/data/uploads/quoteitems/company_(?<company>\d+)/[A-Za-z0-9_\-]{1,100}\.(png|jpg|jpeg|webp|gif)$",
            RegexOptions.Compiled | RegexOptions.IgnoreCase);

        public static string CompanyRelDir(int companyId) => $"{RootRelDir}/company_{companyId}";

        public static string BuildUrl(int companyId, string fileName) => $"/{CompanyRelDir(companyId)}/{fileName}";

        /// <summary>True when the URL is a well-formed image path inside this company's folder.</summary>
        public static bool IsOwnedBy(string? url, int companyId)
        {
            if (string.IsNullOrWhiteSpace(url) || url.Length > MaxUrlLength) return false;
            var m = UrlPattern.Match(url.Trim());
            return m.Success
                && int.TryParse(m.Groups["company"].Value, out var c)
                && c == companyId;
        }

        /// <summary>
        /// Blank/whitespace → null (line has no image). A valid own-company path
        /// is returned trimmed. Anything else throws — never silently dropped, so
        /// a forged path surfaces as a 400 instead of a mysteriously blank image.
        /// </summary>
        public static string? Normalize(string? url, int companyId)
        {
            if (string.IsNullOrWhiteSpace(url)) return null;
            var trimmed = url.Trim();
            if (!IsOwnedBy(trimmed, companyId))
                throw new InvalidOperationException("A line image path is not a valid image upload for this company.");
            return trimmed;
        }

        /// <summary>
        /// Duplicates a line image under a fresh name for the Copy Document flow
        /// and returns the new URL. Two quotes must never point at one file:
        /// clearing a line or deleting either quote runs <see cref="TryDelete"/>,
        /// which would blank the image on the other. Returns null when the source
        /// file is missing or the copy fails, so the line is simply copied without
        /// its photo rather than pointing at nothing.
        /// </summary>
        public static string? TryCopy(string? url, int companyId)
        {
            if (!IsOwnedBy(url, companyId)) return null;
            try
            {
                var root = Directory.GetCurrentDirectory();
                var abs = Path.Combine(root, url!.TrimStart('/').Replace('/', Path.DirectorySeparatorChar));
                if (!File.Exists(abs)) return null;

                var ext = Path.GetExtension(abs);
                var fileName = $"{Guid.NewGuid():N}{ext}";
                var destDir = Path.Combine(root, CompanyRelDir(companyId).Replace('/', Path.DirectorySeparatorChar));
                Directory.CreateDirectory(destDir);
                File.Copy(abs, Path.Combine(destDir, fileName));
                return BuildUrl(companyId, fileName);
            }
            catch
            {
                return null;
            }
        }

        /// <summary>
        /// Best-effort delete of the backing file when a line's image is replaced,
        /// cleared, or its quote is deleted. A missing/locked file must never
        /// break the save — an orphaned file is harmless, a failed save isn't.
        /// </summary>
        public static void TryDelete(string? url, int companyId)
        {
            if (!IsOwnedBy(url, companyId)) return;
            try
            {
                var abs = Path.Combine(Directory.GetCurrentDirectory(), url!.TrimStart('/').Replace('/', Path.DirectorySeparatorChar));
                if (File.Exists(abs)) File.Delete(abs);
            }
            catch { /* orphaned file is harmless */ }
        }
    }
}
