using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// Customer outstanding ledger import: read the workbook, reconcile it
    /// against its own index sheet, then write clients, invoices and receipts.
    ///
    /// Reconciliation is the point of the preview, not a nicety. A reporting
    /// import fails as a plausible wrong number rather than a crash, so the
    /// importer proves every customer's closing balance agrees with the source
    /// BEFORE anything is written, and refuses the import when one does not.
    /// </summary>
    public interface ICustomerLedgerImportService
    {
        Task<CustomerLedgerPreviewDto> PreviewAsync(
            byte[] bytes,
            string extension,
            string fileName,
            string fileSha256,
            string mappingJson,
            int companyId,
            int? profileId,
            int? profileVersion,
            DateTime? periodStart = null,
            DateTime? periodEnd = null,
            DateTime? openingDate = null);

        Task<CustomerLedgerCommitResultDto> CommitAsync(CustomerLedgerCommitDto dto, int userId);
    }
}
