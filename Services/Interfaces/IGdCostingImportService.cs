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
        ///
        /// <paramref name="mode"/> is one of <see cref="GdCostingImportModeNames"/>
        /// (null/unrecognised normalises to Backfill) and decides only how a
        /// MATCHED line's consequence is worded and previewed
        /// (<see cref="GdCostingLineDto.MatchNote"/>,
        /// <see cref="GdCostingLineDto.DerivedActualCost"/>) — it changes
        /// nothing about which lines match, since preview never writes
        /// anything either way.
        /// </summary>
        Task<GdCostingPreviewDto> PreviewAsync(
            byte[] bytes,
            string extension,
            string fileName,
            string fileSha256,
            string mappingJson,
            int companyId,
            int? profileId,
            int? profileVersion,
            string? mode);

        /// <summary>
        /// Builds ONE consignment line from a hand-typed form (Task 18:
        /// "enter a line by hand" on the Import Costing screen) and runs it
        /// through the exact same match/cost/consignment pipeline
        /// <see cref="PreviewAsync"/> gives a whole workbook — same matching,
        /// same disposition rules, same costing arithmetic, same duplicate
        /// guards, same <paramref name="mode"/>-aware wording. There is no
        /// separate manual commit: the returned <see cref="GdCostingPreviewDto"/>
        /// feeds straight into the existing <see cref="CommitAsync"/>,
        /// unchanged.
        ///
        /// A line that breaks a rule is NOT refused: it comes back with its
        /// <see cref="GdCostingLineDto.Problems"/> filled, beside every other
        /// line. Throws <see cref="InvalidOperationException"/> only when there
        /// is nothing to preview (no lines, too many, a null line).
        ///
        /// <paramref name="source"/> is set when the lines are an uploaded
        /// workbook's, re-checked after an edit in the review: the preview then
        /// keeps that file's name and SHA-256, so the import is recorded against
        /// the file and the file still cannot be imported twice.
        /// </summary>
        Task<GdCostingPreviewDto> PreviewManualAsync(
            IReadOnlyList<GdCostingManualLineDto> lines, int companyId, string? mode,
            GdCostingSourceDto? source = null);

        /// <summary>
        /// Writes the reviewed lines in one transaction: the import run, one
        /// consignment per GD, one line per row, and — per
        /// <see cref="GdCostingCommitDto.Mode"/> — either SETS or ADDS the
        /// actual cost (and, under New Arrivals, the quantity and selling
        /// value too) onto every matched (cost-only) balance.
        /// </summary>
        Task<GdCostingCommitResultDto> CommitAsync(GdCostingCommitDto dto, int userId);
    }
}
