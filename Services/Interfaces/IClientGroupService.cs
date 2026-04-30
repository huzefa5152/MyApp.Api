using MyApp.Api.DTOs;
using MyApp.Api.Models;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// Owns the "Common Client" grouping layer. The single source of truth
    /// for ComputeGroupKey() — every other path that needs to know "what
    /// group does this client belong to" comes through here so the
    /// normalisation rules stay consistent.
    /// </summary>
    public interface IClientGroupService
    {
        /// <summary>
        /// Find-or-create the <see cref="ClientGroup"/> for the given client
        /// and stamp <see cref="Client.ClientGroupId"/>. Idempotent — calling
        /// it on every Client save keeps the grouping in lock-step with the
        /// client's current Name / NTN. Caller is responsible for SaveChanges.
        /// </summary>
        Task<ClientGroup> EnsureGroupForClientAsync(Client client);

        /// <summary>
        /// "Common Clients" list for the panel above the company-scoped
        /// client list. Returns groups where <paramref name="companyId"/>
        /// has a member AND at least one OTHER company also has a member.
        /// Single-company groups are intentionally hidden — they're shown
        /// only in the existing per-company list.
        /// </summary>
        Task<List<CommonClientDto>> GetCommonClientsAsync(int companyId);

        /// <summary>
        /// Every <see cref="ClientGroup"/> (single-company AND multi-company) —
        /// used by config screens like PO Formats that pick one Client per
        /// legal entity rather than per company. CompanyCount is reported so
        /// the operator can still see at a glance which entries are
        /// cross-tenant.
        /// </summary>
        Task<List<CommonClientDto>> GetAllGroupsAsync();

        /// <summary>
        /// Detail view: master fields + per-company members (sites etc.).
        /// </summary>
        Task<CommonClientDetailDto?> GetByIdAsync(int groupId);

        /// <summary>
        /// Propagate master-field changes to every <see cref="Client"/> in
        /// the group. Returns the cascade summary for the toast.
        /// </summary>
        Task<CommonClientUpdateResultDto> UpdateAsync(int groupId, CommonClientUpdateDto dto);

        /// <summary>
        /// Delete the Common Client across every tenant: removes each
        /// per-company <see cref="Client"/> row (with the same cascade
        /// the existing single-tenant ClientService.DeleteAsync uses —
        /// invoices, invoice items, delivery items, challans), then
        /// removes the <see cref="ClientGroup"/> row itself.
        ///
        /// Returns a list of company-name "deleted from" labels so the
        /// caller can show a clear toast. Throws on the first member
        /// that fails to delete (transactional — partial deletes are
        /// rolled back).
        /// </summary>
        Task<CommonClientUpdateResultDto> DeleteAsync(int groupId);

        /// <summary>
        /// Pure helper exposed so other paths (the startup backfill, the
        /// PO matcher, future merge tooling) compute group keys the same
        /// way as the runtime EnsureGroup path.
        /// </summary>
        (string GroupKey, string? NormalizedNtn, string NormalizedName) ComputeGroupKey(string? name, string? ntn);
    }
}
