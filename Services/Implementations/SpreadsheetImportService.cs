using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Helpers.ExcelImport;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <inheritdoc cref="ISpreadsheetImportService"/>
    public class SpreadsheetImportService : ISpreadsheetImportService
    {
        private readonly AppDbContext _db;

        /// <summary>
        /// Below this, a stored layout is not worth offering — the operator is
        /// better served mapping from scratch than correcting a bad guess.
        /// </summary>
        private const double MinCandidateSimilarity = 0.60;

        /// <summary>Near-matches offered at once. More than a handful is a
        /// picker nobody reads.</summary>
        private const int MaxCandidates = 5;

        /// <summary>Sheets described back to the mapping UI.</summary>
        private const int MaxPreviewSheets = 12;

        private const int PreviewRows = 12;
        private const int PreviewCols = 20;

        public SpreadsheetImportService(AppDbContext db) => _db = db;

        public async Task<ImportIdentifyResultDto> IdentifyAsync(
            byte[] bytes,
            string extension,
            string fileName,
            string fileSha256,
            string kind,
            int companyId,
            IReadOnlyCollection<int> accessibleCompanyIds)
        {
            var canonicalKind = ImportKinds.Canonical(kind);
            var result = new ImportIdentifyResultDto
            {
                FileName = fileName,
                FileSizeBytes = bytes.LongLength,
                FileSha256 = fileSha256,
                Kind = canonicalKind ?? kind,
            };

            if (canonicalKind == null)
            {
                result.Errors.Add("Unknown import type.");
                return result;
            }

            result.AvailableLayouts = ImportLayouts.ByKind[canonicalKind].ToList();

            using (var stream = new MemoryStream(bytes, writable: false))
            using (var workbook = WorkbookReaderFactory.Open(stream, extension))
            {
                var fingerprint = WorkbookFingerprint.Compute(workbook);
                result.SignatureHash = fingerprint.Hash;
                result.TokenSignature = fingerprint.TokenSignature;
                result.Sheets = DescribeSheets(workbook);
            }

            // Same bytes, already imported here. Reported by identify rather than
            // left for commit so the operator finds out before mapping anything.
            result.AlreadyImported = await FindBlockingRunAsync(companyId, canonicalKind, fileSha256);
            if (result.AlreadyImported != null)
            {
                var who = result.AlreadyImported.ImportedByUserName;
                var when = result.AlreadyImported.ImportedAt.ToString("d MMM yyyy");
                result.Errors.Add(who == null
                    ? $"This exact file was already imported on {when}. Nothing was changed."
                    : $"This exact file was already imported on {when} by {who}. Nothing was changed.");
            }

            await MatchProfilesAsync(result, canonicalKind, companyId, accessibleCompanyIds);

            if (result.MatchedProfile == null && result.Candidates.Count == 0)
                result.Warnings.Add("This layout has not been seen before. Map the columns to continue — the mapping is saved for next time.");

            return result;
        }

        public async Task<ImportRunDto?> FindBlockingRunAsync(int companyId, string kind, string fileSha256)
        {
            if (string.IsNullOrWhiteSpace(fileSha256)) return null;
            var sha = fileSha256.Trim().ToLowerInvariant();

            var row = await _db.ImportRuns.AsNoTracking()
                .Where(r => r.CompanyId == companyId
                            && r.Kind == kind
                            && r.FileSha256 == sha
                            && !r.IsSuperseded)
                .OrderByDescending(r => r.ImportedAt)
                .FirstOrDefaultAsync();

            return row == null ? null : await ToDtoAsync(row);
        }

        public async Task<PagedResult<ImportRunDto>> GetRunsAsync(
            int companyId, string? kind, int page, int? pageSize)
        {
            var size = PaginationHelper.Clamp(pageSize, 25, PaginationHelper.AuditMax);
            var pageNo = PaginationHelper.ClampPage(page);

            var q = _db.ImportRuns.AsNoTracking().Where(r => r.CompanyId == companyId);

            var canonicalKind = ImportKinds.Canonical(kind);
            if (kind != null)
            {
                if (canonicalKind == null)
                    return new PagedResult<ImportRunDto> { Page = pageNo, PageSize = size };
                q = q.Where(r => r.Kind == canonicalKind);
            }

            var total = await q.CountAsync();
            var rows = await q
                .OrderByDescending(r => r.ImportedAt).ThenByDescending(r => r.Id)
                .Skip((pageNo - 1) * size).Take(size)
                .ToListAsync();

            var items = new List<ImportRunDto>(rows.Count);
            foreach (var row in rows) items.Add(await ToDtoAsync(row));

            return new PagedResult<ImportRunDto>
            {
                Items = items,
                TotalCount = total,
                Page = pageNo,
                PageSize = size,
            };
        }

        public async Task<ImportRunDto?> SupersedeAsync(
            int runId, int companyId, string reason, int userId)
        {
            // Scoped by company in the same query as the id: a run in another
            // tenant must read as "not found", never as "forbidden", which would
            // confirm it exists.
            var run = await _db.ImportRuns
                .FirstOrDefaultAsync(r => r.Id == runId && r.CompanyId == companyId);
            if (run == null) return null;

            if (run.IsSuperseded) return await ToDtoAsync(run);

            run.IsSuperseded = true;
            run.SupersededAt = DateTime.UtcNow;
            run.SupersededByUserId = userId;
            run.SupersedeReason = reason.Trim().Length > 1000 ? reason.Trim()[..1000] : reason.Trim();

            await _db.SaveChangesAsync();
            return await ToDtoAsync(run);
        }

        // ── Helpers ──────────────────────────────────────────────────────────

        /// <summary>
        /// Fills the exact match and the near-match candidates. Exact means the
        /// signature hash is identical; anything else is a suggestion a human
        /// confirms, because a wrong layout silently reads amounts out of the
        /// wrong column.
        /// </summary>
        private async Task MatchProfilesAsync(
            ImportIdentifyResultDto result,
            string kind,
            int companyId,
            IReadOnlyCollection<int> accessibleCompanyIds)
        {
            var allowed = accessibleCompanyIds.ToList();

            var visible = await _db.ImportProfiles.AsNoTracking()
                .Where(p => p.Kind == kind
                            && p.IsActive
                            // Usable by THIS company: its own, or shared.
                            && (p.CompanyId == null || p.CompanyId == companyId)
                            // ...and still inside what the caller may see at all.
                            && (p.CompanyId == null || allowed.Contains(p.CompanyId.Value)))
                .Select(p => new { p.Id, p.Name, p.Layout, p.CompanyId, p.SignatureHash, p.TokenSignature })
                .ToListAsync();

            var scored = new List<ImportProfileMatchDto>();
            foreach (var p in visible)
            {
                var exact = string.Equals(p.SignatureHash, result.SignatureHash, StringComparison.OrdinalIgnoreCase);
                var similarity = exact
                    ? 1d
                    : WorkbookFingerprint.Similarity(p.TokenSignature, result.TokenSignature);

                scored.Add(new ImportProfileMatchDto
                {
                    ProfileId = p.Id,
                    Name = p.Name,
                    Layout = p.Layout,
                    IsShared = p.CompanyId == null,
                    Similarity = Math.Round(similarity, 4),
                    IsExact = exact,
                });
            }

            result.MatchedProfile = scored
                .Where(s => s.IsExact)
                // A company's own layout wins over a shared one with the same
                // signature — the private mapping is the more specific answer.
                .OrderBy(s => s.IsShared ? 1 : 0)
                .ThenBy(s => s.ProfileId)
                .FirstOrDefault();

            result.Candidates = scored
                .Where(s => !s.IsExact && s.Similarity >= MinCandidateSimilarity)
                .OrderByDescending(s => s.Similarity)
                .ThenBy(s => s.IsShared ? 1 : 0)
                .Take(MaxCandidates)
                .ToList();
        }

        private static List<WorkbookSheetPreviewDto> DescribeSheets(IImportedWorkbook workbook)
        {
            var sheets = new List<WorkbookSheetPreviewDto>();
            var count = Math.Min(workbook.WorksheetCount, MaxPreviewSheets);

            for (int i = 0; i < count; i++)
            {
                var lastRow = workbook.GetLastRow(i);
                var sheet = new WorkbookSheetPreviewDto
                {
                    Index = i,
                    Name = workbook.GetSheetName(i),
                    LastRow = lastRow,
                };

                var rows = Math.Min(lastRow, PreviewRows);
                for (int row = 1; row <= rows; row++)
                {
                    var cells = new List<string>(PreviewCols);
                    for (int col = 1; col <= PreviewCols; col++)
                        cells.Add(workbook.GetString(i, row, col));

                    // Trailing blanks carry no information and triple the payload
                    // on a wide sheet.
                    while (cells.Count > 0 && string.IsNullOrWhiteSpace(cells[^1]))
                        cells.RemoveAt(cells.Count - 1);

                    sheet.Rows.Add(cells);
                }

                sheets.Add(sheet);
            }

            return sheets;
        }

        private async Task<ImportRunDto> ToDtoAsync(ImportRun run)
        {
            var profileName = run.ImportProfileId == null
                ? null
                : await _db.ImportProfiles.AsNoTracking()
                    .Where(p => p.Id == run.ImportProfileId)
                    .Select(p => p.Name)
                    .FirstOrDefaultAsync();

            var userName = await _db.Users.AsNoTracking()
                .Where(u => u.Id == run.ImportedByUserId)
                .Select(u => string.IsNullOrWhiteSpace(u.FullName) ? u.Username : u.FullName)
                .FirstOrDefaultAsync();

            return new ImportRunDto
            {
                Id = run.Id,
                CompanyId = run.CompanyId,
                Kind = run.Kind,
                ImportProfileId = run.ImportProfileId,
                ProfileName = profileName,
                ProfileVersion = run.ProfileVersion,
                FileSha256 = run.FileSha256,
                OriginalFileName = run.OriginalFileName,
                FileSizeBytes = run.FileSizeBytes,
                Counts = DecodeCounts(run.CountsJson),
                ImportedByUserId = run.ImportedByUserId,
                ImportedByUserName = userName,
                ImportedAt = run.ImportedAt,
                IsSuperseded = run.IsSuperseded,
                SupersededAt = run.SupersededAt,
                SupersedeReason = run.SupersedeReason,
            };
        }

        /// <summary>
        /// Counts are display-only, so a malformed blob must not take the whole
        /// history page down with it.
        /// </summary>
        private static Dictionary<string, int> DecodeCounts(string? json)
        {
            if (string.IsNullOrWhiteSpace(json)) return new Dictionary<string, int>();
            try
            {
                return JsonSerializer.Deserialize<Dictionary<string, int>>(json)
                       ?? new Dictionary<string, int>();
            }
            catch (JsonException)
            {
                return new Dictionary<string, int>();
            }
        }
    }
}
