using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// The upload side of the spreadsheet importer: recognise a workbook, report
    /// whether it has been imported before, and keep the history of what was
    /// imported into a company.
    ///
    /// Preview and commit for each import kind land on top of this in later
    /// passes; identify is deliberately separate because it is the only step
    /// that must run before an operator has chosen anything at all.
    /// </summary>
    public interface ISpreadsheetImportService
    {
        /// <summary>
        /// Fingerprints a validated workbook, looks for a profile that
        /// recognises it, and checks whether this exact file has already been
        /// imported into this company for this kind.
        ///
        /// <paramref name="bytes"/> must already have passed
        /// <see cref="Helpers.ExcelUploadValidator"/> — this method assumes the
        /// file is a readable workbook and does not re-validate.
        /// </summary>
        Task<ImportIdentifyResultDto> IdentifyAsync(
            byte[] bytes,
            string extension,
            string fileName,
            string fileSha256,
            string kind,
            int companyId,
            IReadOnlyCollection<int> accessibleCompanyIds);

        /// <summary>
        /// Prior import of the same bytes for this (company, kind) that is still
        /// blocking, or null. Callers use this to refuse a commit; it reads the
        /// same rows the filtered unique index enforces.
        /// </summary>
        Task<ImportRunDto?> FindBlockingRunAsync(int companyId, string kind, string fileSha256);

        Task<PagedResult<ImportRunDto>> GetRunsAsync(
            int companyId, string? kind, int page, int? pageSize);

        /// <summary>
        /// Marks a run superseded so its file can be imported again. Returns null
        /// when the run does not exist or is not in
        /// <paramref name="companyId"/> — never leak that a run exists in
        /// another tenant.
        /// </summary>
        Task<ImportRunDto?> SupersedeAsync(
            int runId, int companyId, string reason, int userId);
    }
}
