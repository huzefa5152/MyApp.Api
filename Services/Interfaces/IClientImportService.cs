using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// Bulk client onboarding from a CSV / Excel sheet.
    ///
    /// Two steps on purpose: <see cref="ParseAsync"/> writes nothing and hands
    /// the operator a per-row verdict, then <see cref="CommitAsync"/> creates
    /// exactly the rows they confirmed. Creating still goes through
    /// <see cref="IClientService"/>, so Common Client grouping, name-collision
    /// rules and tenant fields behave identically to typing a client by hand.
    /// </summary>
    public interface IClientImportService
    {
        /// <summary>The sample sheet, as CSV bytes — headers plus two example rows.</summary>
        byte[] BuildTemplateCsv();

        /// <summary>
        /// Read an uploaded sheet and classify every row against what the
        /// company already has. No writes. Never throws for bad content: an
        /// unreadable file comes back as a file-level message.
        /// </summary>
        Task<ClientImportPreviewDto> ParseAsync(Stream file, string fileName, int companyId);

        /// <summary>
        /// Create the confirmed rows. Rows still marked Duplicate are skipped
        /// unless the caller opts in; a row that fails is reported and the rest
        /// of the import continues.
        /// </summary>
        Task<ClientImportResultDto> CommitAsync(ClientImportCommitDto dto);
    }
}
