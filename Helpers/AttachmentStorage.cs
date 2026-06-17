using System.Security.Cryptography;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Disk storage for the unified attachment system. Files are grouped by the
    /// system folder the operator filed them under — flat, mirroring what the
    /// operator sees:
    ///   <c>{ContentRoot}/data/attachments/{FolderName | "Uncategorized"}/{guid}{ext}</c>
    /// No companyId / year / month directories (the DB row's CompanyId still
    /// scopes tenancy). GUID-named so the original filename can't drive a
    /// path-traversal or collide.
    ///
    /// NOTE: the <c>/data/attachments</c> URL path is NOT served by the static
    /// file middleware (see Program.cs) — downloads go only through the
    /// authenticated, access-checked endpoint.
    /// </summary>
    public class AttachmentStorage
    {
        public const string RelativeRoot = "data/attachments";
        public const string Uncategorized = "Uncategorized";

        private readonly string _root;

        public AttachmentStorage(IWebHostEnvironment env)
        {
            _root = Path.Combine(env.ContentRootPath, "data", "attachments");
        }

        /// <summary>Absolute storage root — used by the one-time re-home backfill.</summary>
        public string Root => _root;

        /// <summary>Ensure the storage root exists (called once at startup).</summary>
        public void EnsureRoot() => Directory.CreateDirectory(_root);

        /// <summary>
        /// Persists the uploaded file under the given folder bucket and returns
        /// the metadata for the Attachment row. <paramref name="folderName"/> is
        /// the system folder's name, or null/empty for "Uncategorized". The
        /// relative path uses forward slashes (portable, resolved at read time).
        /// Capped upstream by the validator + [RequestSizeLimit], so buffering
        /// into memory here can't blow up the heap.
        /// </summary>
        public async Task<StoredFile> SaveAsync(string? folderName, IFormFile file, CancellationToken ct = default)
        {
            using var ms = new MemoryStream();
            await file.CopyToAsync(ms, ct);
            var bytes = ms.ToArray();

            var ext = Path.GetExtension(file.FileName ?? "").ToLowerInvariant();
            var storedName = $"{Guid.NewGuid():N}{ext}";
            var relDir = DirName(folderName);
            Directory.CreateDirectory(Path.Combine(_root, relDir));

            var absPath = Path.Combine(_root, relDir, storedName);
            await File.WriteAllBytesAsync(absPath, bytes, ct);

            return new StoredFile(storedName, $"{relDir}/{storedName}", ComputeSha256(bytes), ext);
        }

        /// <summary>Absolute path for a stored relative path; null when missing on disk.</summary>
        public string? ResolveExisting(string storagePath)
        {
            var abs = Path.Combine(_root, storagePath.Replace('/', Path.DirectorySeparatorChar));
            return File.Exists(abs) ? abs : null;
        }

        /// <summary>Best-effort delete; never throws (the DB row is the source of truth).</summary>
        public void TryDelete(string storagePath)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(storagePath)) return;
                var abs = Path.Combine(_root, storagePath.Replace('/', Path.DirectorySeparatorChar));
                if (File.Exists(abs)) File.Delete(abs);
            }
            catch { /* swallow — orphaned bytes are harmless and get pruned later */ }
        }

        /// <summary>
        /// Maps a system folder name to a safe on-disk directory name
        /// ("Uncategorized" when none). Public so the storage-flatten backfill
        /// can compute the same target paths.
        /// </summary>
        public static string DirName(string? folderName)
        {
            var n = (folderName ?? "").Trim();
            if (string.IsNullOrWhiteSpace(n)) return Uncategorized;
            foreach (var c in Path.GetInvalidFileNameChars()) n = n.Replace(c, '_');
            n = n.Replace('/', '_').Replace('\\', '_').Trim().TrimEnd('.', ' ');
            if (string.IsNullOrWhiteSpace(n)) return Uncategorized;
            if (n.Length > 100) n = n.Substring(0, 100).TrimEnd('.', ' ');
            // Windows reserved device names can't be directory names.
            string[] reserved = { "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5",
                "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9" };
            if (Array.Exists(reserved, r => string.Equals(r, n, StringComparison.OrdinalIgnoreCase))) n = "_" + n;
            return n;
        }

        private static string ComputeSha256(byte[] bytes)
        {
            using var sha = SHA256.Create();
            return Convert.ToHexString(sha.ComputeHash(bytes)).ToLowerInvariant();
        }

        public record StoredFile(string StoredFileName, string StoragePath, string Sha256, string Extension);
    }
}
