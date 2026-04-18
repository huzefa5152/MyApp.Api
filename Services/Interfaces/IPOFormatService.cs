using MyApp.Api.DTOs;
using MyApp.Api.Models;

namespace MyApp.Api.Services.Interfaces
{
    // Extracts a stable, text-only fingerprint from a raw PO PDF text dump.
    // Deliberately has no layout/coordinate awareness — we bet on anchor
    // labels being the most durable signal across revisions of the same
    // template.
    public interface IPOFormatFingerprintService
    {
        FingerprintResult Compute(string rawText);
    }

    public record FingerprintResult(string Hash, string Signature, IReadOnlyList<string> Keywords);

    // Routes an incoming PDF to a known POFormat (or reports a miss so the
    // caller can fall back to LLM + operator onboarding).
    public interface IPOFormatRegistry
    {
        Task<POFormatMatchResult?> FindMatchAsync(string rawText, int? companyId);
        Task<List<POFormat>> ListAsync(int? companyId);
        Task<POFormat?> GetAsync(int id);
        Task<List<POFormatVersion>> GetVersionsAsync(int formatId);
        Task<POFormat> CreateAsync(POFormatCreateDto dto, string? createdBy);
        // Regression-gated update: if the candidate rule-set causes any
        // verified golden sample to regress (or leak into another format),
        // the update is refused and the returned report has Passed=false.
        // On refusal, the DB state is left unchanged.
        Task<(POFormat? Format, RegressionReportDto Report)> UpdateRulesAsync(int id, string ruleSetJson, string? changeNote, string? updatedBy, bool enforceRegression = true);
        Task<POFormat?> UpdateMetaAsync(int id, POFormatUpdateMetaDto dto);
    }

    // Similarity is 1.0 when the hash matches exactly. Otherwise it's a
    // Jaccard score over the keyword sets — useful for surfacing "did you
    // mean this existing format?" suggestions during onboarding.
    public record POFormatMatchResult(POFormat Format, double Similarity, bool IsExactMatch);
}
