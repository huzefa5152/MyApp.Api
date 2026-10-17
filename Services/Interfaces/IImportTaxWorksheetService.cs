using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    public interface IImportTaxWorksheetService
    {
        /// <summary>The monthly input-tax worksheet. Error is the 400 message, or null.</summary>
        Task<(string? Error, InputTaxWorksheetDto? Dto)> BuildAsync(int companyId, string? fromMonth, string? toMonth);

        /// <summary>Every GD costing line with its import taxes and claim month.</summary>
        Task<List<GdRegisterLineDto>> CostingLinesAsync(int companyId);

        Task<Dictionary<string, DateTime?>> ClaimPeriodsAsync(int companyId);
    }
}
