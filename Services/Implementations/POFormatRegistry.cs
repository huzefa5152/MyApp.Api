using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class POFormatRegistry : IPOFormatRegistry
    {
        // Below this Jaccard score we refuse to auto-route to an existing
        // format even as a "near match" hint — false positives here would
        // cause the wrong parsing rule-set to run and return garbage.
        private const double FuzzyMatchFloor = 0.70;

        private readonly AppDbContext _db;
        private readonly IPOFormatFingerprintService _fingerprint;
        private readonly IRegressionService _regression;
        private readonly ILogger<POFormatRegistry> _logger;

        public POFormatRegistry(
            AppDbContext db,
            IPOFormatFingerprintService fingerprint,
            IRegressionService regression,
            ILogger<POFormatRegistry> logger)
        {
            _db = db;
            _fingerprint = fingerprint;
            _regression = regression;
            _logger = logger;
        }

        public async Task<POFormatMatchResult?> FindMatchAsync(string rawText, int? companyId)
        {
            var fp = _fingerprint.Compute(rawText);
            if (string.IsNullOrEmpty(fp.Hash)) return null;

            // Active formats only: company-scoped first, then globals
            var candidates = await _db.POFormats
                .AsNoTracking()
                .Where(f => f.IsActive && (f.CompanyId == companyId || f.CompanyId == null))
                .ToListAsync();

            if (candidates.Count == 0) return null;

            // 1) Exact hash match — routing is deterministic
            var exact = candidates.FirstOrDefault(f => f.SignatureHash == fp.Hash);
            if (exact != null)
            {
                _logger.LogInformation("PO format exact match: formatId={FormatId} name={Name}", exact.Id, exact.Name);
                return new POFormatMatchResult(exact, 1.0, IsExactMatch: true);
            }

            // 2) Fuzzy: Jaccard similarity over keyword sets. Useful for "this
            //    looks close to format X, but the template must have changed" —
            //    we surface it but mark IsExactMatch=false so the caller decides
            //    whether to trust it (typically only used as a UI hint).
            var incomingSet = new HashSet<string>(fp.Keywords, StringComparer.OrdinalIgnoreCase);
            POFormat? best = null;
            double bestScore = 0;
            foreach (var cand in candidates)
            {
                var candSet = cand.KeywordSignature.Split('|',
                    StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                var score = Jaccard(incomingSet, new HashSet<string>(candSet, StringComparer.OrdinalIgnoreCase));
                if (score > bestScore) { bestScore = score; best = cand; }
            }

            if (best != null && bestScore >= FuzzyMatchFloor)
            {
                _logger.LogInformation("PO format fuzzy match: formatId={FormatId} name={Name} score={Score:F2}", best.Id, best.Name, bestScore);
                return new POFormatMatchResult(best, bestScore, IsExactMatch: false);
            }

            return null;
        }

        public Task<List<POFormat>> ListAsync(int? companyId)
        {
            var q = _db.POFormats.AsNoTracking().OrderByDescending(f => f.UpdatedAt).AsQueryable();
            if (companyId.HasValue)
                q = q.Where(f => f.CompanyId == companyId || f.CompanyId == null);
            return q.ToListAsync();
        }

        public Task<POFormat?> GetAsync(int id) =>
            _db.POFormats.AsNoTracking().FirstOrDefaultAsync(f => f.Id == id);

        public Task<List<POFormatVersion>> GetVersionsAsync(int formatId) =>
            _db.POFormatVersions.AsNoTracking()
                .Where(v => v.POFormatId == formatId)
                .OrderByDescending(v => v.Version)
                .ToListAsync();

        public async Task<POFormat> CreateAsync(POFormatCreateDto dto, string? createdBy)
        {
            var fp = _fingerprint.Compute(dto.RawText);
            var ruleSet = string.IsNullOrWhiteSpace(dto.RuleSetJson) ? "{}" : dto.RuleSetJson;

            var format = new POFormat
            {
                Name = dto.Name?.Trim() ?? "",
                CompanyId = dto.CompanyId,
                ClientId = dto.ClientId,
                // ClientGroupId is the source of truth for "which client
                // does this format apply to" in the multi-tenant Common
                // Clients model — the matcher resolves the per-tenant
                // client row off this. ClientId is kept alongside it
                // for backward compatibility with legacy callers.
                ClientGroupId = dto.ClientGroupId,
                SignatureHash = fp.Hash,
                KeywordSignature = fp.Signature,
                RuleSetJson = ruleSet,
                CurrentVersion = 1,
                IsActive = true,
                Notes = dto.Notes,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            };
            _db.POFormats.Add(format);
            await _db.SaveChangesAsync();

            _db.POFormatVersions.Add(new POFormatVersion
            {
                POFormatId = format.Id,
                Version = 1,
                RuleSetJson = ruleSet,
                ChangeNote = "Initial version",
                CreatedBy = createdBy,
                CreatedAt = DateTime.UtcNow,
            });
            await _db.SaveChangesAsync();
            return format;
        }

        public async Task<(POFormat? Format, RegressionReportDto Report)> UpdateRulesAsync(int id, string ruleSetJson, string? changeNote, string? updatedBy, bool enforceRegression = true)
        {
            var format = await _db.POFormats.FirstOrDefaultAsync(f => f.Id == id);
            if (format == null) return (null, new RegressionReportDto { Passed = false });

            var candidate = string.IsNullOrWhiteSpace(ruleSetJson) ? "{}" : ruleSetJson;

            // Non-negotiable safety constraint: replay the candidate against
            // every verified golden sample before committing. If any previously-
            // green sample now regresses, refuse the update and leave the DB
            // untouched. The caller gets the diff so they can see why.
            RegressionReportDto report;
            if (enforceRegression)
            {
                report = await _regression.TestRuleSetAsync(id, candidate, crossFormatCheck: true);
                if (!report.Passed)
                {
                    _logger.LogWarning("Rule update for format {Id} refused — {Failed} samples regressed", id, report.FailedSamples);
                    return (null, report);
                }
            }
            else
            {
                report = new RegressionReportDto { Passed = true };
            }

            format.CurrentVersion += 1;
            format.RuleSetJson = candidate;
            format.UpdatedAt = DateTime.UtcNow;

            _db.POFormatVersions.Add(new POFormatVersion
            {
                POFormatId = format.Id,
                Version = format.CurrentVersion,
                RuleSetJson = format.RuleSetJson,
                ChangeNote = changeNote,
                CreatedBy = updatedBy,
                CreatedAt = DateTime.UtcNow,
            });

            await _db.SaveChangesAsync();
            return (format, report);
        }

        public async Task<POFormat?> UpdateMetaAsync(int id, POFormatUpdateMetaDto dto)
        {
            var format = await _db.POFormats.FirstOrDefaultAsync(f => f.Id == id);
            if (format == null) return null;

            format.Name = dto.Name?.Trim() ?? format.Name;
            format.IsActive = dto.IsActive;
            format.Notes = dto.Notes;
            format.UpdatedAt = DateTime.UtcNow;

            await _db.SaveChangesAsync();
            return format;
        }

        private static double Jaccard(HashSet<string> a, HashSet<string> b)
        {
            if (a.Count == 0 && b.Count == 0) return 0;
            var inter = a.Intersect(b, StringComparer.OrdinalIgnoreCase).Count();
            var union = a.Count + b.Count - inter;
            return union == 0 ? 0 : (double)inter / union;
        }
    }
}
