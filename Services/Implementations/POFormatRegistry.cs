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
            if (companyId is not > 0) return null;
            var fp = _fingerprint.Compute(rawText);
            if (string.IsNullOrEmpty(fp.Hash)) return null;

            // Never match another company or an unowned legacy format.
            var candidates = await _db.POFormats
                .AsNoTracking()
                .Where(f => f.IsActive && f.CompanyId == companyId && f.Client != null && f.Client.CompanyId == companyId)
                .OrderBy(f => f.Id)
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
            //    Both sides are cleaned the same way before comparing
            //    (POFormatFingerprintService.ComputeMatchKeywords): item-row text
            //    and a time-of-day prefix are data, not layout.
            var incomingSet = POFormatFingerprintService.ComputeMatchKeywords(rawText);
            POFormat? best = null;
            double bestScore = 0;
            foreach (var cand in candidates)
            {
                var score = POFormatFingerprintService.MatchScore(
                    incomingSet, POFormatFingerprintService.StoredMatchKeywords(cand.KeywordSignature));
                if (score > bestScore) { bestScore = score; best = cand; }
            }

            if (best != null && bestScore >= FuzzyMatchFloor)
            {
                _logger.LogInformation("PO format fuzzy match: formatId={FormatId} name={Name} score={Score:F2}", best.Id, best.Name, bestScore);
                return new POFormatMatchResult(best, bestScore, IsExactMatch: false);
            }

            return null;
        }

        // Below this share of a format's signature words, text read from an
        // image is not routed to it. Calibrated on the production archive (see
        // POFormatFingerprintService.OcrCoverageScore): real matches 0.97-1.00,
        // documents with no saved format at most 0.73.
        private const double OcrCoverageFloor = 0.85;

        public async Task<POFormatMatchResult?> FindMatchForOcrAsync(string rawText, int? companyId)
        {
            // The normal matcher first: a clean photo can match exactly as its PDF would.
            var normal = await FindMatchAsync(rawText, companyId);
            if (normal != null) return normal;
            if (string.IsNullOrWhiteSpace(rawText) || companyId is not > 0) return null;

            // The same candidates FindMatchAsync considers: never another
            // company's format, never an unowned legacy one.
            var candidates = await _db.POFormats
                .AsNoTracking()
                .Where(f => f.IsActive && f.CompanyId == companyId && f.Client != null && f.Client.CompanyId == companyId)
                .OrderBy(f => f.Id)
                .ToListAsync();
            if (candidates.Count == 0) return null;

            // Highest coverage wins; near-identical layouts (the Meko family)
            // can tie, and the regular fuzzy score breaks the tie.
            var incoming = POFormatFingerprintService.ComputeMatchKeywords(rawText);
            var best = candidates
                .Select(f => (Format: f,
                    Coverage: POFormatFingerprintService.OcrCoverageScore(rawText, f.KeywordSignature),
                    Fuzzy: POFormatFingerprintService.MatchScore(incoming, POFormatFingerprintService.StoredMatchKeywords(f.KeywordSignature))))
                .OrderByDescending(x => x.Coverage).ThenByDescending(x => x.Fuzzy)
                .First();
            if (best.Coverage < OcrCoverageFloor) return null;

            _logger.LogInformation("PO format OCR match: formatId={FormatId} name={Name} coverage={Coverage:F2}",
                best.Format.Id, best.Format.Name, best.Coverage);
            return new POFormatMatchResult(best.Format, best.Coverage, IsExactMatch: false);
        }

        public Task<List<POFormat>> ListAsync(int? companyId)
        {
            return _db.POFormats.AsNoTracking()
                .Where(f => companyId != null && f.CompanyId == companyId && f.Client != null && f.Client.CompanyId == companyId)
                .OrderByDescending(f => f.UpdatedAt).ToListAsync();
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
                // Metadata only; ownership and matching use CompanyId and ClientId.
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
            _db.POFormatVersions.Add(new POFormatVersion
            {
                POFormat = format,
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
    }
}
