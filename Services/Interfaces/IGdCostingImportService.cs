using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// GD (Goods Declaration) costing import: read a customs costing sheet,
    /// match each line to the company's existing opening stock, and say what
    /// it would do — then, on commit, write only the actual cost onto matched
    /// balances.
    ///
    /// Preview and commit are asymmetric exactly as
    /// <see cref="IOpeningStockImportService"/>'s are: preview takes the FILE
    /// and writes nothing; commit takes the REVIEWED LINES and never re-reads
    /// the file, so what an operator approved on screen is exactly what lands.
    ///
    /// Round 1 scope: no stock movement and no GL entry. A line that would be
    /// booked as brand-new stock is recorded as skipped, with a reason, rather
    /// than posted or silently dropped.
    /// </summary>
    public interface IGdCostingImportService
    {
        /// <summary>
        /// Parses the sheet and matches every line against the company's
        /// opening stock balances and lots, in memory. Throws
        /// <see cref="InvalidOperationException"/> when the mapping cannot
        /// drive an import at all.
        /// </summary>
        Task<GdCostingPreviewDto> PreviewAsync(
            byte[] bytes,
            string extension,
            string fileName,
            string fileSha256,
            string mappingJson,
            int companyId,
            int? profileId,
            int? profileVersion);

        /// <summary>
        /// Writes the reviewed lines in one transaction: the import run, one
        /// consignment per GD, one line per row, and the actual cost onto every
        /// matched (cost-only) balance.
        /// </summary>
        Task<GdCostingCommitResultDto> CommitAsync(GdCostingCommitDto dto, int userId);
    }
}
