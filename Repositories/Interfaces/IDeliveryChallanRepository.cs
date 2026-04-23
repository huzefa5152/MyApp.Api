using MyApp.Api.Models;

namespace MyApp.Api.Repositories.Interfaces
{
    public interface IDeliveryChallanRepository
    {
        Task<List<DeliveryChallan>> GetDeliveryChallansByCompanyAsync(int companyId);
        Task<(List<DeliveryChallan> Items, int TotalCount)> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize,
            string? search = null, string? status = null,
            int? clientId = null, DateTime? dateFrom = null, DateTime? dateTo = null);
        Task<DeliveryChallan?> GetByIdAsync(int id);
        Task<DeliveryChallan> CreateDeliveryChallanAsync(DeliveryChallan deliveryChallan);
        Task<DeliveryChallan> UpdateAsync(DeliveryChallan deliveryChallan);
        Task DeleteAsync(DeliveryChallan deliveryChallan);
        Task DeleteItemAsync(DeliveryItem item);
        Task<DeliveryItem?> GetItemByIdAsync(int itemId);
        Task<List<DeliveryChallan>> GetPendingChallansByCompanyAsync(int companyId);
        Task<int> GetTotalCountAsync();
        Task<int> GetCountByCompanyAsync(int companyId);
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
        /// Batched version of <see cref="ChallanNumberExistsAsync"/>. Given a
        /// list of candidate challan numbers, returns just the subset that
        /// already exists on this company. Used by the preview endpoint to
        /// flag duplicates for the whole upload in a single round-trip.
        /// </summary>
        Task<HashSet<int>> GetExistingChallanNumbersAsync(int companyId, IEnumerable<int> candidateNumbers);
    }
}
