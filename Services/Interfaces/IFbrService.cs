using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    public interface IFbrService
    {
        // Submit & Validate (V1.12 §4.1, §4.2)
        Task<FbrSubmissionResult> SubmitInvoiceAsync(int invoiceId, string? scenarioId = null);
        Task<FbrSubmissionResult> ValidateInvoiceAsync(int invoiceId, string? scenarioId = null);
        /// <summary>
        /// Dry-run: build the FBR payload JSON without sending it. Result's
        /// Preview field carries the would-be JSON + URL + item count.
        /// </summary>
        Task<FbrSubmissionResult> PreviewInvoicePayloadAsync(int invoiceId, string? scenarioId = null);

        // Reference APIs v1 (V1.12 §5.1–§5.6)
        Task<List<FbrProvinceDto>> GetProvincesAsync(int companyId);
        Task<List<FbrDocTypeDto>> GetDocTypesAsync(int companyId);
        // saleType (optional) narrows the result to HS codes whose
        // HS-prefix heuristic maps to that sale type — used by the inline
        // New-Item-Type modal so its typeahead only suggests codes that
        // are valid under the parent bill's locked scenario.
        Task<List<FbrHSCodeDto>> GetHSCodesAsync(int companyId, string? search = null, string? saleType = null);

        /// <summary>
        /// Validate an HS code against the cached FBR catalog. Returns
        /// true iff the code is present (exact, case-insensitive match).
        ///
        /// Falls back to format-only validation (PCT pattern
        /// <c>NNNN.NNNN</c> with optional <c>.NN</c> tail) when the
        /// catalog cannot be loaded — typically during a fresh tenant
        /// onboarding before any FBR token has been entered. Logs a
        /// warning in that case so operators can audit.
        ///
        /// 2026-05-13: added so ItemType create/update can reject free-
        /// text HS codes that don't exist in PRAL's master list. Pre-fix
        /// an operator could type any string into the HS Code field and
        /// the row would save, later causing FBR submission to fail with
        /// a cryptic [0007] / [0052].
        /// </summary>
        Task<bool> IsKnownHsCodeAsync(int companyId, string hsCode);
        Task<List<FbrUOMDto>> GetUOMsAsync(int companyId);
        Task<List<FbrTransactionTypeDto>> GetTransactionTypesAsync(int companyId);
        Task<List<FbrSROItemDto>> GetSROItemCodesAsync(int companyId);

        // Reference APIs v2 (V1.12 §5.7–§5.10)
        Task<List<FbrSaleTypeRateDto>> GetSaleTypeRatesAsync(int companyId, string date, int transTypeId, int provinceId);
        Task<List<FbrSRODto>> GetSROScheduleAsync(int companyId, int rateId, string date, int provinceId);
        Task<List<FbrSROItemDto>> GetSROItemsAsync(int companyId, string date, int sroId);
        Task<List<FbrUOMDto>> GetHSCodeUOMAsync(int companyId, string hsCode, int annexureId);

        // STATL / Registration (V1.12 §5.11, §5.12)
        Task<FbrRegStatusDto?> CheckRegistrationStatusAsync(int companyId, string regNo, string date);
        Task<FbrRegTypeDto?> GetRegistrationTypeAsync(int companyId, string regNo);
    }
}
