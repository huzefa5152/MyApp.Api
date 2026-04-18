using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    public interface IRegressionService
    {
        // Replays the candidate rule-set against all verified golden samples
        // for the target format. Returns a pass/fail report — consumers
        // refuse the rule-set change if Passed=false.
        //
        // Cross-format check is optional: when true, also verifies the
        // candidate rule-set does NOT produce output on *other* formats'
        // samples (prevents a lax regex from accidentally swallowing a
        // different vendor's PDFs).
        Task<RegressionReportDto> TestRuleSetAsync(int formatId, string candidateRuleSetJson, bool crossFormatCheck = true);

        // One-off replay: parse arbitrary raw text with a candidate rule-set
        // without persisting anything. Powers the "preview" button in the UI.
        RegressionReportDto DryRun(string candidateRuleSetJson, string rawText, string formatName);
    }
}
