using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// The onboarding workbook: a sample to fill in, a preview that writes
    /// nothing, a commit that re-reads the same file, and a fix list of the
    /// rows that cannot import. <paramref name="sheets"/> is always the set
    /// the caller is allowed to import — the controller intersects it with
    /// the caller's create permissions before calling.
    /// </summary>
    public interface IOnboardingImportService
    {
        Task<byte[]> BuildSampleAsync(int companyId, IReadOnlyList<string> sheets);
        Task<OnboardingPreviewDto> PreviewAsync(Stream file, string fileName, int companyId, IReadOnlyList<string> sheets);
        Task<OnboardingCommitResultDto> CommitAsync(Stream file, string fileName, int companyId, IReadOnlyList<string> sheets, string? userName);
        Task<byte[]> BuildFixListAsync(Stream file, string fileName, int companyId, IReadOnlyList<string> sheets);
    }

    /// <summary>A file the import refuses as a whole (too many rows, unreadable). The message is safe to show.</summary>
    public class OnboardingFileException : Exception
    {
        public OnboardingFileException(string message) : base(message) { }
    }
}
