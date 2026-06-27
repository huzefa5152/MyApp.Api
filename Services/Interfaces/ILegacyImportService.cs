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

    /// <summary>
    /// Faithful ETL from the legacy Data_2021 database into a target MyApp
    /// company (design §13). Reads the legacy DB read-only via the "LegacyDb"
    /// connection string (Development only); writes via EF with verbatim values
    /// and ExternalRef idempotency. Disabled when LegacyDb isn't configured.
    /// </summary>
    public interface ILegacyImportService
    {
        bool IsConfigured { get; }

        /// <summary>Import the masters: chart of accounts (structure, party
        /// ledgers excluded) + parties (Trader → Client/Supplier). Idempotent.</summary>
        Task<LegacyImportResult> ImportMastersAsync(int companyId);
    }
}
