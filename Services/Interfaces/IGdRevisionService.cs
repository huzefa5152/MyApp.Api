using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// Revise a recorded GD from one sheet instead of one line at a time.
    ///
    /// The sheet is the GD as it should now read. Each of its lines either
    /// matches a recorded line (unchanged, or corrected in place exactly as
    /// "Correct this line" does), or is new (added as an arrival), and a
    /// recorded line the sheet no longer has is removed. All of it applies in
    /// one transaction or none of it does. It never leaves an item holding less
    /// than nothing: a quantity already sold cannot be revised away.
    ///
    /// New Arrivals GDs only. A Backfill GD priced stock that was already on
    /// the books; its lines are corrected one at a time.
    /// </summary>
    public interface IGdRevisionService
    {
        /// <summary>The recorded GD as a workbook in the built-in costing layout: the file to edit and upload back.</summary>
        Task<(byte[] Bytes, string FileName, int CompanyId)?> ExportAsync(int consignmentId);

        /// <summary>Reads the sheet and says what it would do. Writes nothing.</summary>
        Task<GdRevisionPreviewDto> PreviewAsync(
            int consignmentId, byte[] bytes, string extension, string fileName, string fileSha256,
            string mappingJson, int? profileId, int? profileVersion);

        /// <summary>The same plan from lines already read (an agent, or the commit's own re-check).</summary>
        Task<GdRevisionPreviewDto> PreviewLinesAsync(int consignmentId, GdCostingPreviewDto sheet);

        /// <summary>Applies the reviewed lines. Throws <see cref="InvalidOperationException"/>, having changed nothing, when any part cannot be applied.</summary>
        Task<GdRevisionResultDto> CommitAsync(int consignmentId, GdRevisionCommitDto dto, int userId);
    }
}
