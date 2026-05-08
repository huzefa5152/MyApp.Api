using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// Computes the per-HS-Code "input-tax bank" — how much input tax
    /// is still claimable against historical purchases for each HS Code
    /// the operator is about to invoice. Drives the in-form tax-claim
    /// panel on the Invoices-tab edit screen.
    /// </summary>
    public interface ITaxClaimService
    {
        // Phase A entry — bank/pending only. Kept for back-compat;
        // delegates to GetClaimSummaryAsync internally.
        Task<TaxClaimSummaryResponse> GetHsStockSummaryAsync(
            int companyId, IList<string> hsCodes);

        // Phase B entry — full claim summary including per-sale match,
        // §8A aging, §8B cap, IRIS reconciliation gate.
        Task<TaxClaimSummaryResponse> GetClaimSummaryAsync(TaxClaimSummaryRequest request);
    }
}
