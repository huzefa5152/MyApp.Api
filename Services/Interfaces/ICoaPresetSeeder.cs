namespace MyApp.Api.Services.Interfaces
{
    /// <summary>Lays down a sector-preset Chart of Accounts for a company.
    /// Idempotent — every row carries a stable <c>"seed:*"</c> ExternalRef, so a
    /// re-run adds only what is missing and never duplicates.</summary>
    public interface ICoaPresetSeeder
    {
        /// <summary>Seed the "Wholesale / Distribution" preset. Returns the number
        /// of groups + accounts created (0 when everything already existed).</summary>
        Task<int> SeedWholesaleAsync(int companyId);
    }
}
