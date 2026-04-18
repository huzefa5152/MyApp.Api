using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class RegressionService : IRegressionService
    {
        private readonly AppDbContext _db;
        private readonly IRuleBasedPOParser _parser;
        private readonly IPOFormatFingerprintService _fingerprint;
        private readonly ILogger<RegressionService> _logger;

        private static readonly JsonSerializerOptions JsonOpts = new()
        {
            PropertyNameCaseInsensitive = true,
        };

        public RegressionService(
            AppDbContext db,
            IRuleBasedPOParser parser,
            IPOFormatFingerprintService fingerprint,
            ILogger<RegressionService> logger)
        {
            _db = db;
            _parser = parser;
            _fingerprint = fingerprint;
            _logger = logger;
        }

        public async Task<RegressionReportDto> TestRuleSetAsync(int formatId, string candidateRuleSetJson, bool crossFormatCheck = true)
        {
            var format = await _db.POFormats.AsNoTracking().FirstOrDefaultAsync(f => f.Id == formatId);
            if (format == null)
            {
                return new RegressionReportDto
                {
                    Passed = false,
                    Outcomes = new List<SampleOutcomeDto>
                    {
                        new() { Result = "fail", Diffs = new List<string> { $"Format {formatId} not found." } }
                    }
                };
            }

            // Own golden samples — these MUST still match the candidate rule-set.
            var ownSamples = await _db.POGoldenSamples.AsNoTracking()
                .Where(s => s.POFormatId == formatId)
                .ToListAsync();

            var report = new RegressionReportDto { Passed = true, TotalSamples = 0 };

            // Project a lightweight in-memory copy of the target format with the
            // candidate rule-set baked in, so we can feed it to the parser.
            var candidateFormat = CloneWith(format, candidateRuleSetJson);

            foreach (var sample in ownSamples)
            {
                report.TotalSamples++;
                if (!string.Equals(sample.Status, "verified", StringComparison.OrdinalIgnoreCase))
                {
                    report.SkippedSamples++;
                    report.Outcomes.Add(new SampleOutcomeDto
                    {
                        SampleId = sample.Id,
                        FormatId = format.Id,
                        FormatName = format.Name,
                        SampleName = sample.Name,
                        Result = "skip",
                        Diffs = new List<string> { $"Sample status is '{sample.Status}' — not gating." }
                    });
                    continue;
                }

                var expected = DeserializeExpected(sample.ExpectedJson);
                var parsed = _parser.Parse(sample.RawText, candidateFormat);
                var actual = Project(parsed);
                var diffs = Diff(expected, actual);

                var outcome = new SampleOutcomeDto
                {
                    SampleId = sample.Id,
                    FormatId = format.Id,
                    FormatName = format.Name,
                    SampleName = sample.Name,
                    Result = diffs.Count == 0 ? "pass" : "fail",
                    Diffs = diffs,
                    Expected = expected,
                    Actual = actual,
                };
                report.Outcomes.Add(outcome);
                if (outcome.Result == "pass") report.PassedSamples++;
                else { report.FailedSamples++; report.Passed = false; }
            }

            if (crossFormatCheck)
            {
                // Cross-format leak check: run the candidate rule-set against
                // OTHER formats' verified samples. A "hard" collision (real
                // safety issue) happens only when BOTH conditions hold:
                //   1. The candidate rule-set extracts items from another
                //      sample's text, AND
                //   2. That sample's fingerprint ALSO exact-matches THIS
                //      format — i.e. the routing layer could actually send
                //      the other sample to this rule-set in production.
                //
                // If only (1) holds (extraction leaks but routing wouldn't
                // send it here), we surface it as a "warn" outcome — the
                // operator sees the info but the gate still passes.
                var otherSamples = await _db.POGoldenSamples.AsNoTracking()
                    .Where(s => s.POFormatId != formatId && s.Status == "verified")
                    .ToListAsync();

                foreach (var sample in otherSamples)
                {
                    report.TotalSamples++;
                    var parsed = _parser.Parse(sample.RawText, candidateFormat);
                    var actual = Project(parsed);
                    var leaked = actual.Items.Count > 0;

                    if (!leaked)
                    {
                        report.PassedSamples++;
                        report.Outcomes.Add(new SampleOutcomeDto
                        {
                            SampleId = sample.Id,
                            FormatId = sample.POFormatId,
                            FormatName = "other",
                            SampleName = sample.Name,
                            Result = "pass",
                        });
                        continue;
                    }

                    // Leaked — check whether it would actually route to THIS format.
                    var otherFp = _fingerprint.Compute(sample.RawText);
                    var wouldRoute = string.Equals(otherFp.Hash, format.SignatureHash, StringComparison.OrdinalIgnoreCase);

                    var outcome = new SampleOutcomeDto
                    {
                        SampleId = sample.Id,
                        FormatId = sample.POFormatId,
                        FormatName = "other",
                        SampleName = sample.Name,
                        Result = wouldRoute ? "fail" : "warn",
                        Diffs = wouldRoute
                            ? new List<string>
                              {
                                  $"Hard collision: this candidate extracts {actual.Items.Count} items from another format's sample AND that sample's fingerprint routes here."
                              }
                            : new List<string>
                              {
                                  $"Soft leak (extraction only, no routing collision): candidate extracts {actual.Items.Count} items from a different format's sample. Safe because fingerprint routing would send that PDF to its real format."
                              },
                        Actual = actual,
                    };
                    report.Outcomes.Add(outcome);
                    if (outcome.Result == "fail") { report.FailedSamples++; report.Passed = false; }
                    else { report.PassedSamples++; } // warn doesn't gate
                }
            }

            _logger.LogInformation("Regression {FormatName}: {Pass}/{Total} passed", format.Name, report.PassedSamples, report.TotalSamples);
            return report;
        }

        public RegressionReportDto DryRun(string candidateRuleSetJson, string rawText, string formatName)
        {
            var tmpFormat = new POFormat
            {
                Id = 0,
                Name = formatName,
                RuleSetJson = candidateRuleSetJson,
            };
            var parsed = _parser.Parse(rawText, tmpFormat);
            var actual = Project(parsed);
            return new RegressionReportDto
            {
                Passed = true,
                TotalSamples = 1,
                PassedSamples = 1,
                Outcomes = new List<SampleOutcomeDto>
                {
                    new()
                    {
                        FormatName = formatName,
                        SampleName = "(dry run)",
                        Result = "pass",
                        Actual = actual,
                    }
                }
            };
        }

        // ----- helpers -----

        private static POFormat CloneWith(POFormat format, string ruleSetJson) => new()
        {
            Id = format.Id,
            Name = format.Name,
            CompanyId = format.CompanyId,
            SignatureHash = format.SignatureHash,
            KeywordSignature = format.KeywordSignature,
            RuleSetJson = ruleSetJson,
            CurrentVersion = format.CurrentVersion,
            IsActive = format.IsActive,
        };

        private static ExpectedResultDto Project(ParsedPODto p) => new()
        {
            PoNumber = p.PONumber,
            PoDate = p.PODate,
            Items = p.Items.Select(i => new ExpectedItemDto
            {
                Description = i.Description,
                Quantity = i.Quantity,
                Unit = i.Unit,
            }).ToList(),
        };

        private static ExpectedResultDto DeserializeExpected(string json)
        {
            if (string.IsNullOrWhiteSpace(json)) return new ExpectedResultDto();
            try
            {
                return JsonSerializer.Deserialize<ExpectedResultDto>(json, JsonOpts) ?? new ExpectedResultDto();
            }
            catch
            {
                return new ExpectedResultDto();
            }
        }

        // Collect a list of human-readable diffs between expected and actual.
        // Description comparison is whitespace-tolerant since PDF extraction
        // is noisy (leading/trailing punctuation, collapsed newlines). We
        // don't normalize aggressively — the whole point of regression is to
        // catch real changes.
        private static List<string> Diff(ExpectedResultDto expected, ExpectedResultDto actual)
        {
            var diffs = new List<string>();

            if (!string.Equals(expected.PoNumber?.Trim(), actual.PoNumber?.Trim(), StringComparison.OrdinalIgnoreCase))
                diffs.Add($"poNumber: expected '{expected.PoNumber}' got '{actual.PoNumber}'");

            if (expected.PoDate?.Date != actual.PoDate?.Date)
                diffs.Add($"poDate: expected '{expected.PoDate:yyyy-MM-dd}' got '{actual.PoDate:yyyy-MM-dd}'");

            if (expected.Items.Count != actual.Items.Count)
            {
                diffs.Add($"items count: expected {expected.Items.Count} got {actual.Items.Count}");
            }
            else
            {
                for (int i = 0; i < expected.Items.Count; i++)
                {
                    var e = expected.Items[i];
                    var a = actual.Items[i];
                    if (e.Quantity != a.Quantity)
                        diffs.Add($"item[{i}].quantity: expected {e.Quantity} got {a.Quantity}");
                    if (!string.Equals(NormalizeUnit(e.Unit), NormalizeUnit(a.Unit), StringComparison.OrdinalIgnoreCase))
                        diffs.Add($"item[{i}].unit: expected '{e.Unit}' got '{a.Unit}'");
                    if (!DescriptionsMatch(e.Description, a.Description))
                        diffs.Add($"item[{i}].description: expected '{Trunc(e.Description)}' got '{Trunc(a.Description)}'");
                }
            }

            return diffs;
        }

        private static string NormalizeUnit(string? u) => (u ?? "").Trim().TrimEnd('.').ToLowerInvariant();

        private static bool DescriptionsMatch(string expected, string actual)
        {
            // Exact match after whitespace collapse + case-insensitive.
            var e = System.Text.RegularExpressions.Regex.Replace((expected ?? "").Trim(), @"\s+", " ");
            var a = System.Text.RegularExpressions.Regex.Replace((actual ?? "").Trim(), @"\s+", " ");
            return string.Equals(e, a, StringComparison.OrdinalIgnoreCase);
        }

        private static string Trunc(string s) => s.Length > 60 ? s[..60] + "…" : s;
    }
}
