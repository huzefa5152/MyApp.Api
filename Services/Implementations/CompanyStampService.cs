using System.Text;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class CompanyStampService : ICompanyStampService
    {
        private readonly ICompanyStampRepository _repo;

        public CompanyStampService(ICompanyStampRepository repo) => _repo = repo;

        public async Task<CompanyStamp> AddAsync(int companyId, IFormFile file, string? name)
        {
            Validate(file);

            var displayName = string.IsNullOrWhiteSpace(name)
                ? Path.GetFileNameWithoutExtension(file.FileName) ?? "Stamp"
                : name.Trim();
            if (string.IsNullOrWhiteSpace(displayName)) displayName = "Stamp";
            if (displayName.Length > 100) displayName = displayName[..100];

            // Stable, unique-per-company slug. Never changes after creation.
            var slug = await UniqueSlugAsync(companyId, displayName);

            var (url, path) = Location(companyId, slug, file);
            await SaveFileAsync(file, path);

            return await _repo.CreateAsync(new CompanyStamp
            {
                CompanyId = companyId,
                Name = displayName,
                Slug = slug,
                FilePath = url,
                SortOrder = await _repo.NextSortOrderAsync(companyId),
                UpdatedAt = DateTime.UtcNow,
            });
        }

        // The id and slug stay, so {{stamps.<slug>}} and every template's assignment show the new image
        // with no template edited. The same file type keeps the same URL, so a print page another user
        // already has open keeps working; a new file type moves the URL until that page reloads.
        public async Task<CompanyStamp?> ReplaceImageAsync(int companyId, int id, IFormFile file)
        {
            var stamp = await FindAsync(companyId, id);
            if (stamp == null) return null;
            Validate(file);

            var (url, path) = Location(companyId, stamp.Slug, file);
            var oldUrl = stamp.FilePath;
            var movesFile = !string.Equals(url, oldUrl, StringComparison.OrdinalIgnoreCase);

            // Written beside the target first: a failed upload must leave the current signature intact.
            var staged = path + ".uploading";
            try
            {
                await SaveFileAsync(file, staged);
                File.Move(staged, path, overwrite: true);
            }
            catch
            {
                File.Delete(staged);
                throw;
            }

            stamp.FilePath = url;
            stamp.UpdatedAt = DateTime.UtcNow;
            try
            {
                await _repo.SaveAsync();
            }
            catch
            {
                if (movesFile) DeleteFile(url);
                throw;
            }
            if (movesFile) DeleteFile(oldUrl);
            return stamp;
        }

        public async Task<CompanyStamp?> UpdateAsync(int companyId, int id, string? name, int? sortOrder)
        {
            var stamp = await FindAsync(companyId, id);
            if (stamp == null) return null;

            // Slug is intentionally NOT touched — templates reference it.
            if (!string.IsNullOrWhiteSpace(name))
            {
                var n = name.Trim();
                stamp.Name = n.Length > 100 ? n[..100] : n;
            }
            if (sortOrder.HasValue) stamp.SortOrder = sortOrder.Value;
            stamp.UpdatedAt = DateTime.UtcNow;
            await _repo.SaveAsync();
            return stamp;
        }

        public async Task<CompanyStamp?> SetDefaultAsync(int companyId, int id)
        {
            var stamp = await FindAsync(companyId, id);
            if (stamp == null) return null;
            await _repo.SetDefaultAsync(companyId, id);
            return await _repo.GetByIdAsync(id);
        }

        public async Task<CompanyStamp?> DeleteAsync(int companyId, int id)
        {
            var stamp = await FindAsync(companyId, id);
            if (stamp == null) return null;
            DeleteFile(stamp.FilePath);
            await _repo.DeleteAsync(stamp);
            return stamp;
        }

        private async Task<CompanyStamp?> FindAsync(int companyId, int id)
        {
            var stamp = await _repo.GetByIdAsync(id);
            return stamp == null || stamp.CompanyId != companyId ? null : stamp;
        }

        private static void Validate(IFormFile file)
        {
            var error = ImageUploadValidator.Validate(file, ImageUploadValidator.LogoMaxBytes);
            if (error != null) throw new InvalidOperationException(error);
        }

        private static (string Url, string Path) Location(int companyId, string slug, IFormFile file)
        {
            var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
            if (string.IsNullOrEmpty(ext)) ext = ".png";

            var relDir = $"data/uploads/stamps/company_{companyId}";
            var absDir = Path.Combine(Directory.GetCurrentDirectory(), relDir);
            Directory.CreateDirectory(absDir);
            return ($"/{relDir}/{slug}{ext}", Path.Combine(absDir, $"{slug}{ext}"));
        }

        private static async Task SaveFileAsync(IFormFile file, string path)
        {
            using var stream = new FileStream(path, FileMode.Create);
            await file.CopyToAsync(stream);
        }

        // Best-effort: a missing or locked file must not block the change. An orphan is never served,
        // because the /data guard only serves a path a stamp row still names.
        private static void DeleteFile(string url)
        {
            try
            {
                var abs = Path.Combine(Directory.GetCurrentDirectory(), url.TrimStart('/'));
                if (File.Exists(abs)) File.Delete(abs);
            }
            catch { /* orphaned file is harmless; the row is what matters */ }
        }

        // ── slug helpers ──

        private async Task<string> UniqueSlugAsync(int companyId, string name)
        {
            var baseSlug = Slugify(name);
            var slug = baseSlug;
            var n = 2;
            while (await _repo.SlugExistsAsync(companyId, slug))
                slug = $"{baseSlug}_{n++}";
            return slug;
        }

        // [a-z0-9_], collapse runs of non-alnum to a single underscore, never
        // starts with a digit (Handlebars path segment safety), capped length.
        private static string Slugify(string input)
        {
            var sb = new StringBuilder();
            bool lastUnderscore = false;
            foreach (var ch in input.Trim().ToLowerInvariant())
            {
                if (char.IsLetterOrDigit(ch) && ch < 128)
                {
                    sb.Append(ch);
                    lastUnderscore = false;
                }
                else if (!lastUnderscore)
                {
                    sb.Append('_');
                    lastUnderscore = true;
                }
            }
            var slug = sb.ToString().Trim('_');
            if (string.IsNullOrEmpty(slug)) slug = "stamp";
            if (char.IsDigit(slug[0])) slug = "s_" + slug;
            if (slug.Length > 50) slug = slug[..50].Trim('_');
            return slug;
        }
    }
}
