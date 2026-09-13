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
        Task<PagedResult<ImportConsignmentListItemDto>> GetPagedAsync(int companyId, int page, int? pageSize);

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
    }
}
