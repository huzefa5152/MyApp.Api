using MyApp.Api.Models;

namespace MyApp.Api.Repositories.Interfaces
{
    public interface IDeliveryChallanRepository
    {
        /// <param name="allowedDivisionIds">Division-RBAC scope: when non-null the
        /// caller is division-restricted and only rows tagged with one of these
        /// divisions (or no division — company-level rows stay shared, policy D1)
        /// are returned. Null = unrestricted, no filter.</param>
        Task<List<DeliveryChallan>> GetDeliveryChallansByCompanyAsync(int companyId, HashSet<int>? allowedDivisionIds = null);
        Task<(List<DeliveryChallan> Items, int TotalCount)> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize,
            string? search = null, string? status = null,
            int? clientId = null, DateTime? dateFrom = null, DateTime? dateTo = null,
            int? divisionId = null, HashSet<int>? allowedDivisionIds = null);
        Task<DeliveryChallan?> GetByIdAsync(int id);
        Task<DeliveryChallan> CreateDeliveryChallanAsync(DeliveryChallan deliveryChallan);
        Task<DeliveryChallan> UpdateAsync(DeliveryChallan deliveryChallan);
        Task DeleteAsync(DeliveryChallan deliveryChallan);
        Task DeleteItemAsync(DeliveryItem item);
        Task<DeliveryItem?> GetItemByIdAsync(int itemId);
        /// <summary>Billable challans: "Pending" + "Imported", plus "No PO" when
        /// <paramref name="includeNoPo"/> (FBR-off companies don't require a
        /// customer PO to bill).</summary>
        Task<List<DeliveryChallan>> GetPendingChallansByCompanyAsync(int companyId, bool includeNoPo = false, HashSet<int>? allowedDivisionIds = null);
        Task<int> GetTotalCountAsync();
        Task<int> GetCountByCompanyAsync(int companyId, HashSet<int>? allowedDivisionIds = null);
        Task<bool> HasChallansForCompanyAsync(int companyId);
        Task<List<DeliveryChallan>> GetSetupRequiredChallansAsync(int companyId, int? clientId = null);

        /// <summary>
        /// Insert a challan with the caller-supplied ChallanNumber (historical
        /// import). Validates (CompanyId, ChallanNumber) uniqueness. Does NOT
        /// bump Company.CurrentChallanNumber — the live counter is untouched.
        /// </summary>
        Task<DeliveryChallan> CreateImportedChallanAsync(DeliveryChallan deliveryChallan);

        /// <summary>
        /// Returns true if a challan with (CompanyId, ChallanNumber) already
        /// exists — used by import to reject duplicates before trying to insert.
        /// </summary>
        Task<bool> ChallanNumberExistsAsync(int companyId, int challanNumber);

        /// <summary>
        /// Clone an existing challan: same ChallanNumber, fresh Id, Items deep-
        /// copied, Status + IsImported inherited from the source so historical
        /// (Imported) and native (Pending) populations stay correctly tagged
        /// for reporting. InvoiceId cleared so the copy bills independently.
        /// DuplicatedFromId is set to the source's id (or to the source's
        /// parent id if the source itself was already a duplicate, so every
        /// copy points back to the same root for grouping). Does NOT touch
        /// Company.CurrentChallanNumber — the live counter must stay the
        /// highest assigned number.
        /// </summary>
        Task<DeliveryChallan> DuplicateAsync(DeliveryChallan source);

        /// <summary>
        /// Batched version of <see cref="ChallanNumberExistsAsync"/>. Given a
        /// list of candidate challan numbers, returns just the subset that
        /// already exists on this company. Used by the preview endpoint to
        /// flag duplicates for the whole upload in a single round-trip.
        /// </summary>
        Task<HashSet<int>> GetExistingChallanNumbersAsync(int companyId, IEnumerable<int> candidateNumbers);
    }
}
