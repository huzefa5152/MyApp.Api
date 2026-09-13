using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// The read + correction side of the GD costing import (Task 21) —
    /// <see cref="IGdCostingImportService"/> writes a consignment once; this is
    /// what lets an operator look at what was written and, if it was wrong
    /// (wrong company, wrong mode), undo it.
    /// </summary>
    public interface IImportConsignmentService
    {
        /// <summary><paramref name="onlyOutstanding"/> narrows the page to
        /// consignments with Outstanding &gt; 0; either way the result's
        /// default order and <c>TotalOutstanding</c> put what is owed in front
        /// of the operator (Task 23).</summary>
        Task<ImportConsignmentListResultDto> GetPagedAsync(
            int companyId, int page, int? pageSize, bool onlyOutstanding = false);

        /// <summary>Null when no consignment with this id exists. Carries its
        /// own <see cref="ImportConsignmentDetailDto.CompanyId"/> so the
        /// caller can tenant-guard before trusting anything else in it.</summary>
        Task<ImportConsignmentDetailDto?> GetDetailAsync(int id);

        /// <summary>
        /// Undoes exactly what the commit did, in one transaction, or refuses
        /// the whole thing — never a half-undo. See the implementation for the
        /// per-disposition reversal rules. Throws <see cref="InvalidOperationException"/>
        /// with an operator-facing message when any part cannot be safely
        /// undone (nothing is changed in that case).
        /// </summary>
        Task<ImportConsignmentDeleteResultDto> DeleteAsync(int id, int userId);

        /// <summary>
        /// Correct ONE line of a recorded consignment in place, so a single
        /// mistyped duty does not need the whole GD deleted and re-imported
        /// (which a settled GD cannot be at all).
        ///
        /// Same two-pass contract as <see cref="DeleteAsync"/>: everything is
        /// validated and the new balance figures computed before anything is
        /// written, so a refusal leaves the consignment untouched. The cost is
        /// recomputed SERVER-SIDE from the submitted inputs through
        /// <c>ImportCostingCalculator</c> — a caller's own arithmetic is never
        /// trusted, the same rule the commit path keeps.
        ///
        /// What it will not do: move a line to another item, change its
        /// disposition, or change which balance it feeds. Those unwind one
        /// item's stock and load another's, which is a delete-and-reimport.
        ///
        /// Throws <see cref="InvalidOperationException"/> with an
        /// operator-facing message when the correction cannot be applied —
        /// notably when it would take a balance negative, or drop the GD's
        /// posted liability below what has already been settled against it.
        /// </summary>
        Task<ImportConsignmentLineUpdateResultDto> UpdateLineAsync(
            int consignmentId, int lineId, UpdateImportConsignmentLineDto dto, int userId);
    }
}
