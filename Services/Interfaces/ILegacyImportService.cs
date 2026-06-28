namespace MyApp.Api.Services.Interfaces
{
    /// <summary>Result of a legacy-import step — counts of what was created vs
    /// skipped (already present), so a re-run reports 0 created.</summary>
    public class LegacyImportResult
    {
        public Dictionary<string, int> Created { get; set; } = new();
        public Dictionary<string, int> Skipped { get; set; } = new();
        public List<string> Notes { get; set; } = new();
    }

    /// <summary>Outcome of restoring an uploaded .bak: the temp DB to migrate
    /// from, plus a quick content summary for the confirmation screen.</summary>
    public class BackupRestoreResult
    {
        public string SourceDb { get; set; } = "";
        public string? CostCentreName { get; set; }
        public List<string> Divisions { get; set; } = new();
        public int SalesInvoices { get; set; }
        public int SalesQuotes { get; set; }
        public int PurchaseBills { get; set; }
    }

    /// <summary>
    /// Faithful ETL from the legacy Data_2021 database into a target MyApp
    /// company (design §13). Reads the legacy DB read-only via the "LegacyDb"
    /// connection string (Development only); writes via EF with verbatim values
    /// and ExternalRef idempotency. Disabled when LegacyDb isn't configured.
    /// </summary>
    public interface ILegacyImportService
    {
        bool IsConfigured { get; }

        /// <summary>Restore an uploaded .bak into a fresh temp DB and return its
        /// name + a content summary. Subsequent steps read from that DB.</summary>
        Task<BackupRestoreResult> RestoreBackupAsync(Stream bak, string fileName);

        /// <summary>Drop a temp restore DB once migration is finished.</summary>
        Task CleanupAsync(string sourceDb);

        /// <summary>Masters: divisions (CompanyProfile), chart of accounts (party
        /// ledgers excluded) + parties (Trader → Client/Supplier). Idempotent.</summary>
        Task<LegacyImportResult> ImportMastersAsync(string sourceDb, int companyId);

        /// <summary>Documents: sales invoices (GL-anchored, division-tagged),
        /// sales quotes (QuotationMaster, division-tagged) and purchase bills
        /// (company-level). Seeds per-division/company starting numbers. Idempotent.
        /// Requires masters first.</summary>
        Task<LegacyImportResult> ImportDocumentsAsync(string sourceDb, int companyId);

        /// <summary>Receipts (settle invoices) + payments (settle bills) with
        /// allocations, then reflow AmountPaid. Requires documents first.</summary>
        Task<LegacyImportResult> ImportReceiptsPaymentsAsync(string sourceDb, int companyId);
    }
}
