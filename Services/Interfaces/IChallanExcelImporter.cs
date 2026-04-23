using MyApp.Api.DTOs;
using MyApp.Api.Helpers.ExcelImport;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// Extracts a preview row from a single uploaded historical challan file.
    /// Uses the per-company template cell map (built by the reverse mapper) to
    /// know which cell each field lives in, then reads those cells from the
    /// uploaded file. Does NOT touch the database — preview only. The commit
    /// step happens separately after the user has reviewed/edited the result.
    /// </summary>
    public interface IChallanExcelImporter
    {
        Task<ChallanImportPreviewDto> ExtractPreviewAsync(
            IFormFile file,
            TemplateCellMap cellMap,
            int companyId);
    }
}
