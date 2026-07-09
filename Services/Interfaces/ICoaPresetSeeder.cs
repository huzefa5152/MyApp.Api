namespace MyApp.Api.Services.Interfaces
{
    /// <summary>Lays down a sector-preset Chart of Accounts for a company
    /// (design §6). Idempotent — every row carries a stable ExternalRef
    /// ("seed:*"), so re-running upserts rather than duplicating.</summary>
    public interface ICoaPresetSeeder
    {
        /// <summary>Seed the "Wholesale / Distribution" preset. Returns the number
        /// of groups + accounts created (0 when everything already existed).</summary>
        Task<int> SeedWholesaleAsync(int companyId);
    }
}
