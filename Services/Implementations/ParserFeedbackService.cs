using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Logging;
using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class ParserFeedbackService : IParserFeedbackService
    {
        // Original PDFs are retained on disk here, mirroring the PO-import
        // archive layout ({YYYY}/{MM}/{guid}.pdf) but under its own root so the
        // feature owns its storage and never entangles with the import flow.
        private const string StorageRelativeRoot = "Data/uploads/parser_feedback";
        private const int MaxPageSize = 200;

        private readonly IParserFeedbackRepository _repo;
        private readonly IWebHostEnvironment _env;
        private readonly ILogger<ParserFeedbackService> _logger;

        public ParserFeedbackService(
            IParserFeedbackRepository repo,
            IWebHostEnvironment env,
            ILogger<ParserFeedbackService> logger)
        {
            _repo = repo;
            _env = env;
            _logger = logger;
        }

        private string GetRoot()
        {
            var path = Path.Combine(_env.ContentRootPath, StorageRelativeRoot);
            Directory.CreateDirectory(path);
            return path;
        }

        public async Task<ParserFeedbackDto> RecordAsync(RecordParserFeedbackInput input)
        {
            var fb = new ParserFeedback
            {
                PurchaseOrderId = input.PurchaseOrderId,
                CompanyId = input.CompanyId,
                OriginalFileName = Truncate(input.OriginalFileName ?? input.File?.FileName, 255),
                ParserVersion = Truncate(input.ParserVersion, 100),
                FeedbackStatus = input.Status,
                CreatedBy = Truncate(input.CreatedBy, 256),
                CreatedDate = DateTime.UtcNow,
            };

            // Retain the original PDF (best-effort). A disk hiccup must never
            // fail the feedback write — the verdict row is still useful.
            if (input.File != null && input.File.Length > 0)
            {
                try
                {
                    var now = fb.CreatedDate;
                    var rel = Path.Combine(now.Year.ToString("0000"), now.Month.ToString("00"));
                    var absDir = Path.Combine(GetRoot(), rel);
                    Directory.CreateDirectory(absDir);
                    var name = $"{Guid.NewGuid():N}.pdf";
                    var abs = Path.Combine(absDir, name);
                    using (var fs = new FileStream(abs, FileMode.Create, FileAccess.Write))
                        await input.File.CopyToAsync(fs);
                    fb.OriginalPdfLocation = Path.Combine(rel, name).Replace('\\', '/');
                    fb.FileSizeBytes = input.File.Length;
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Could not retain parser-feedback PDF — recording verdict without it");
                }
            }

            await _repo.AddAsync(fb);
            return ToDto(fb);
        }

        public async Task<ParserFeedbackPageDto> GetIncorrectAsync(ParserFeedbackQuery query)
        {
            var page = query.Page < 1 ? 1 : query.Page;
            var size = query.PageSize < 1 ? 50 : Math.Min(query.PageSize, MaxPageSize);
            var (rows, total) = await _repo.ListAsync(
                ParserFeedbackStatus.Incorrect, query.From, query.To, query.ParserVersion,
                query.SortBy, query.Descending, page, size);
            return new ParserFeedbackPageDto
            {
                Total = total,
                Page = page,
                PageSize = size,
                Rows = rows.Select(ToDto).ToList(),
            };
        }

        public async Task<ParserFeedbackStatisticsDto> GetStatisticsAsync()
        {
            var agg = await _repo.AggregateAsync();
            int total = agg.Sum(a => a.Count);
            int success = agg.Where(a => a.Status == ParserFeedbackStatus.Correct).Sum(a => a.Count);
            int failed = agg.Where(a => a.Status == ParserFeedbackStatus.Incorrect).Sum(a => a.Count);

            var byVersion = agg
                .GroupBy(a => a.ParserVersion ?? "(unknown)")
                .Select(g =>
                {
                    int t = g.Sum(x => x.Count);
                    int s = g.Where(x => x.Status == ParserFeedbackStatus.Correct).Sum(x => x.Count);
                    int f = g.Where(x => x.Status == ParserFeedbackStatus.Incorrect).Sum(x => x.Count);
                    return new ParserVersionStatDto
                    {
                        ParserVersion = g.Key,
                        Total = t,
                        Successful = s,
                        Failed = f,
                        SuccessRate = Rate(s, t),
                    };
                })
                .OrderByDescending(v => v.Total)
                .ToList();

            return new ParserFeedbackStatisticsDto
            {
                TotalImports = total,
                SuccessfulImports = success,
                FailedImports = failed,
                SuccessRate = Rate(success, total),
                ByParserVersion = byVersion,
            };
        }

        public async Task<ParserFeedbackPdf?> GetPdfAsync(int id)
        {
            var fb = await _repo.GetAsync(id);
            if (fb == null || string.IsNullOrEmpty(fb.OriginalPdfLocation)) return null;
            var abs = Path.Combine(GetRoot(), fb.OriginalPdfLocation.Replace('/', Path.DirectorySeparatorChar));
            if (!File.Exists(abs)) return null;
            return new ParserFeedbackPdf { FilePath = abs, FileName = SafePdfName(fb.OriginalFileName, fb.Id) };
        }

        public async Task<byte[]?> GetBulkZipAsync(IReadOnlyCollection<int> ids)
        {
            var rows = await _repo.GetManyAsync(ids);
            var withPdf = rows.Where(r => !string.IsNullOrEmpty(r.OriginalPdfLocation)).ToList();
            if (withPdf.Count == 0) return null;

            using var ms = new MemoryStream();
            using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
            {
                var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var r in withPdf)
                {
                    var abs = Path.Combine(GetRoot(), r.OriginalPdfLocation!.Replace('/', Path.DirectorySeparatorChar));
                    if (!File.Exists(abs)) continue;
                    var entryName = UniqueEntryName(used, SafePdfName(r.OriginalFileName, r.Id));
                    var entry = zip.CreateEntry(entryName, CompressionLevel.Fastest);
                    using var es = entry.Open();
                    using var fs = new FileStream(abs, FileMode.Open, FileAccess.Read, FileShare.Read);
                    await fs.CopyToAsync(es);
                }
            }
            return ms.ToArray();
        }

        // ── helpers ──────────────────────────────────────────────────────────
        private static ParserFeedbackDto ToDto(ParserFeedback f) => new()
        {
            Id = f.Id,
            PurchaseOrderId = f.PurchaseOrderId,
            CompanyId = f.CompanyId,
            OriginalFileName = f.OriginalFileName,
            FileSizeBytes = f.FileSizeBytes,
            ParserVersion = f.ParserVersion,
            FeedbackStatus = f.FeedbackStatus.ToString(),
            HasPdf = !string.IsNullOrEmpty(f.OriginalPdfLocation),
            CreatedBy = f.CreatedBy,
            CreatedDate = f.CreatedDate,
        };

        private static double Rate(int part, int total) => total == 0 ? 0 : Math.Round((double)part / total, 4);

        private static string SafePdfName(string? original, int id)
        {
            var baseName = string.IsNullOrWhiteSpace(original)
                ? $"import-{id}"
                : Path.GetFileNameWithoutExtension(original);
            foreach (var c in Path.GetInvalidFileNameChars()) baseName = baseName.Replace(c, '_');
            if (string.IsNullOrWhiteSpace(baseName)) baseName = $"import-{id}";
            return $"{id}_{baseName}.pdf";
        }

        private static string UniqueEntryName(HashSet<string> used, string name)
        {
            var candidate = name;
            int n = 1;
            while (!used.Add(candidate))
                candidate = $"{Path.GetFileNameWithoutExtension(name)}_{n++}.pdf";
            return candidate;
        }

        private static string? Truncate(string? s, int max) =>
            string.IsNullOrEmpty(s) ? s : (s.Length <= max ? s : s.Substring(0, max));
    }
}
