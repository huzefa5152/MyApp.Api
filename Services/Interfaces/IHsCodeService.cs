using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// The local HS / PCT master. Every method here works with FBR integration
    /// switched OFF for every company — the only operation that talks to FBR is
    /// <see cref="ImportAsync"/>, and even that authorises itself with the
    /// installation-wide reference token rather than a tenant's credentials.
    /// </summary>
    public interface IHsCodeService
    {
        /// <summary>
        /// Search the master by code prefix or description substring. Used by the
        /// Item Type form's autocomplete; returns at most <paramref name="take"/> rows.
        /// </summary>
        Task<List<HsCodeDto>> SearchAsync(string? search, int take, bool activeOnly = true);

        Task<HsCodeDto?> GetByCodeAsync(string code);

        /// <summary>How many active codes the master holds — 0 means "never imported".</summary>
        Task<int> CountAsync();

        /// <summary>
        /// Pull FBR's tariff catalog and upsert it: existing codes keep their row,
        /// new codes are inserted. Safe to run repeatedly. Optionally creates a
        /// placeholder Item Type for each code that has none.
        /// </summary>
        Task<HsCodeImportResultDto> ImportAsync(int? companyId, bool createItemTypes, int userId);

        /// <summary>
        /// Load the master from the Pakistan Customs Tariff bundled with the
        /// product — no FBR token and no network call, so it works on an
        /// installation that has never been issued credentials.
        ///
        /// Same upsert contract as <see cref="ImportAsync"/>: existing codes keep
        /// their row and their Item Type links, new codes are inserted, nothing
        /// is ever deleted, and running it twice adds nothing. It brings no UOMs
        /// — the published tariff has no unit column.
        /// </summary>
        Task<HsCodeImportResultDto> ImportFromTariffAsync(bool createItemTypes, int userId);

        /// <summary>
        /// UOMs applicable to one HS code. Answers from the master when it knows
        /// them; otherwise asks FBR (when a token is available) and caches the
        /// answer back onto the master row so the next caller needs no FBR at all.
        /// </summary>
        Task<List<FbrUOMDto>> GetUomsForCodeAsync(string code, int? companyId);

        Task<FbrReferenceTokenStatusDto> GetReferenceTokenStatusAsync();

        Task SetReferenceTokenAsync(string token, string? environment, int userId);
    }
}
