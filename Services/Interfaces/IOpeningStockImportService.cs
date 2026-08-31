using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// Opening stock import: read a stock sheet, say what it would do, then do it.
    ///
    /// The two halves are deliberately asymmetric. Preview takes the FILE and
    /// writes nothing; commit takes the REVIEWED ROWS and never re-reads the
    /// file, so what an operator approved on screen is exactly what lands.
    /// </summary>
    public interface IOpeningStockImportService
    {
        /// <summary>
        /// Parses and classifies the sheet. <paramref name="bytes"/> must
        /// already have passed <see cref="Helpers.ExcelUploadValidator"/>.
        /// Throws <see cref="InvalidOperationException"/> when the mapping
        /// cannot drive an import at all — that is a mapping problem, not a
        /// per-row one, and belongs on the mapping screen.
        /// </summary>
        Task<OpeningStockPreviewDto> PreviewAsync(
            byte[] bytes,
            string extension,
            string fileName,
            string fileSha256,
            string mappingJson,
            int companyId,
            int? profileId,
            int? profileVersion);

        /// <summary>
        /// Writes the reviewed rows in one transaction: item types, opening
        /// quantities, the company's inventory policy, the Inventory account's
        /// opening balance, and the audit run.
        /// </summary>
        Task<OpeningStockCommitResultDto> CommitAsync(OpeningStockCommitDto dto, int userId);
    }
}
