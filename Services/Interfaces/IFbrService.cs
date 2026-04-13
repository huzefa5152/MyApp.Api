using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    public interface IFbrService
    {
        // Submit & Validate (V1.12 §4.1, §4.2)
        Task<FbrSubmissionResult> SubmitInvoiceAsync(int invoiceId, string? scenarioId = null);
        Task<FbrSubmissionResult> ValidateInvoiceAsync(int invoiceId, string? scenarioId = null);

        // Reference APIs v1 (V1.12 §5.1–§5.6)
        Task<List<FbrProvinceDto>> GetProvincesAsync(int companyId);
        Task<List<FbrDocTypeDto>> GetDocTypesAsync(int companyId);
        Task<List<FbrHSCodeDto>> GetHSCodesAsync(int companyId, string? search = null);
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
