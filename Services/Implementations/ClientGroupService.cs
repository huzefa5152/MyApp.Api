using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// Default implementation. Computes group keys, finds-or-creates
    /// groups on every Client save, lists multi-company groups for the
    /// Common Clients UI, and propagates updates across all sibling rows.
    /// </summary>
    public class ClientGroupService : IClientGroupService
    {
        private readonly AppDbContext _db;
        // Resolve IClientService lazily — both services depend on each
        // other (ClientService → ClientGroupService for EnsureGroup;
        // ClientGroupService → ClientService for the per-member cascade
        // delete) so direct DI would create a cycle. IServiceProvider
        // breaks the cycle without wiring an extra interface boundary.
        private readonly IServiceProvider _services;

        public ClientGroupService(AppDbContext db, IServiceProvider services)
        {
            _db = db;
            _services = services;
        }

        // Same regexes used by the startup backfill (kept in C# so the
        // service remains the single source of truth — the SQL backfill
        // mirrors this logic with equivalent T-SQL).
        private static readonly Regex NonDigitRegex = new(@"\D", RegexOptions.Compiled);
        private static readonly Regex CollapseWhitespaceRegex = new(@"\s+", RegexOptions.Compiled);

        // FBR NTNs and CNICs are 7+ digits. Anything shorter is junk
        // (typos, partial entries) — fall back to name-based grouping
        // rather than risk merging different entities under "NTN:42"
        // or similar.
        private const int MinNtnDigits = 7;

        public (string GroupKey, string? NormalizedNtn, string NormalizedName) ComputeGroupKey(string? name, string? ntn)
        {
            var normalizedName = CollapseWhitespaceRegex
                .Replace((name ?? "").Trim().ToLowerInvariant(), " ");

            var ntnDigits = NonDigitRegex.Replace(ntn ?? "", "");
            if (ntnDigits.Length >= MinNtnDigits)
                return ("NTN:" + ntnDigits, ntnDigits, normalizedName);

            // No usable NTN — group by normalised name. An empty name
            // would produce "NAME:" which is still a valid (degenerate)
            // key; the Client form already requires a non-empty name
            // so we don't expect to land there in practice.
            return ("NAME:" + normalizedName, null, normalizedName);
        }

        public async Task<ClientGroup> EnsureGroupForClientAsync(Client client)
        {
            var (key, ntn, name) = ComputeGroupKey(client.Name, client.NTN);

            // Look up by key first — that's the canonical match.
            var group = await _db.ClientGroups.FirstOrDefaultAsync(g => g.GroupKey == key);
            if (group == null)
            {
                group = new ClientGroup
                {
                    GroupKey = key,
                    DisplayName = (client.Name ?? "").Trim(),
                    NormalizedNtn = ntn,
                    NormalizedName = name,
                    CreatedAt = DateTime.UtcNow,
                    UpdatedAt = DateTime.UtcNow,
                };
                _db.ClientGroups.Add(group);
                // Save now so we have an Id for the FK assignment below.
                // EF will batch this with the Client save the caller is
                // about to commit.
                await _db.SaveChangesAsync();
            }
            else
            {
                // Refresh DisplayName to track the most-recently-saved name
                // — operators occasionally tidy up casing / spelling and we
                // want the panel to reflect that. NormalizedNtn / Name only
                // change when the operator edits NTN or Name themselves;
                // EnsureGroup is invoked AFTER such edits so re-syncing is
                // safe.
                group.DisplayName = (client.Name ?? "").Trim();
                group.UpdatedAt = DateTime.UtcNow;
            }

            client.ClientGroupId = group.Id;
            return group;
        }

        public async Task<List<CommonClientDto>> GetCommonClientsAsync(int companyId, IReadOnlyCollection<int> accessibleCompanyIds)
        {
            // "Common Client" = a legal entity that more than one tenant
            // has as a client.
            //
            // Filter rule: HAVING COUNT(DISTINCT CompanyId) >= 2, counted
            // ONLY over companies the caller can reach. companyId still just
            // computes ThisCompanyClientId (the deep-link to the operator's
            // own row).
            //
            // The membership filter is the security boundary. This list used
            // to be built over every Client row in the database on the theory
            // that the panel should "stay stable when the operator switches
            // companies" — but that leaked the NAMES of every tenant sharing
            // the entity to anyone holding any single company. "Common" is
            // relative to the caller: an operator with one company sees an
            // empty panel, because from where they stand nothing is shared.
            var allowed = accessibleCompanyIds as IReadOnlyCollection<int> ?? accessibleCompanyIds.ToList();
            if (allowed.Count == 0) return new List<CommonClientDto>();

            var groupSummaries = await _db.Clients
                .Where(c => c.ClientGroupId != null && allowed.Contains(c.CompanyId))
                .GroupBy(c => c.ClientGroupId!.Value)
                .Where(g => g.Select(c => c.CompanyId).Distinct().Count() >= 2)
                .Select(g => new
                {
                    GroupId = g.Key,
                    CompanyCount = g.Select(c => c.CompanyId).Distinct().Count(),
                    ThisCompanyClientId = g
                        .Where(c => c.CompanyId == companyId)
                        .Select(c => (int?)c.Id)
                        .FirstOrDefault(),
                })
                .ToListAsync();

            if (groupSummaries.Count == 0) return new List<CommonClientDto>();

            var groupIds = groupSummaries.Select(s => s.GroupId).ToList();

            var groups = await _db.ClientGroups
                .Where(g => groupIds.Contains(g.Id))
                .ToDictionaryAsync(g => g.Id);

            // One-shot fetch of the member-company names for the cards —
            // restricted to reachable companies so a card never names a
            // tenant the caller has no access to.
            var memberCompanies = await _db.Clients
                .Where(c => c.ClientGroupId != null
                            && groupIds.Contains(c.ClientGroupId!.Value)
                            && allowed.Contains(c.CompanyId))
                .Select(c => new { c.ClientGroupId, c.Company.Name })
                .ToListAsync();
            var companyNamesByGroup = memberCompanies
                .GroupBy(x => x.ClientGroupId!.Value)
                .ToDictionary(
                    g => g.Key,
                    g => g.Select(x => x.Name).Distinct().OrderBy(n => n).ToList());

            return groupSummaries
                .Select(s => new CommonClientDto
                {
                    GroupId = s.GroupId,
                    DisplayName = groups[s.GroupId].DisplayName,
                    NTN = groups[s.GroupId].NormalizedNtn,
                    CompanyCount = s.CompanyCount,
                    CompanyNames = companyNamesByGroup.GetValueOrDefault(s.GroupId, new List<string>()),
                    ThisCompanyClientId = s.ThisCompanyClientId,
                })
                .OrderBy(c => c.DisplayName)
                .ToList();
        }

        public async Task<List<CommonClientDto>> GetAllGroupsAsync(IReadOnlyCollection<int> accessibleCompanyIds)
        {
            // Every group, single-member or multi-company. Used by config
            // screens (PO Formats etc.) that key off "the legal entity"
            // rather than "the legal entity that this tenant happens to
            // share with another tenant". The per-card metadata is the
            // same shape as the Common Clients panel so the UI can reuse
            // the rendering bits.
            //
            // This route takes no companyId, so it carried NO tenant guard at
            // all — it returned every group in the database. Scoped to the
            // caller's companies; a group with no reachable member drops out
            // because the grouping now has nothing to aggregate.
            var allowed = accessibleCompanyIds as IReadOnlyCollection<int> ?? accessibleCompanyIds.ToList();
            if (allowed.Count == 0) return new List<CommonClientDto>();

            var groupSummaries = await _db.Clients
                .Where(c => c.ClientGroupId != null && allowed.Contains(c.CompanyId))
                .GroupBy(c => c.ClientGroupId!.Value)
                .Select(g => new
                {
                    GroupId = g.Key,
                    CompanyCount = g.Select(c => c.CompanyId).Distinct().Count(),
                    AnyClientId = g.Select(c => (int?)c.Id).FirstOrDefault(),
                })
                .ToListAsync();

            if (groupSummaries.Count == 0) return new List<CommonClientDto>();

            var groupIds = groupSummaries.Select(s => s.GroupId).ToList();

            var groups = await _db.ClientGroups
                .Where(g => groupIds.Contains(g.Id))
                .ToDictionaryAsync(g => g.Id);

            var memberCompanies = await _db.Clients
                .Where(c => c.ClientGroupId != null
                            && groupIds.Contains(c.ClientGroupId!.Value)
                            && allowed.Contains(c.CompanyId))
                .Select(c => new { c.ClientGroupId, c.Company.Name })
                .ToListAsync();
            var companyNamesByGroup = memberCompanies
                .GroupBy(x => x.ClientGroupId!.Value)
                .ToDictionary(
                    g => g.Key,
                    g => g.Select(x => x.Name).Distinct().OrderBy(n => n).ToList());

            return groupSummaries
                .Select(s => new CommonClientDto
                {
                    GroupId = s.GroupId,
                    DisplayName = groups[s.GroupId].DisplayName,
                    NTN = groups[s.GroupId].NormalizedNtn,
                    CompanyCount = s.CompanyCount,
                    CompanyNames = companyNamesByGroup.GetValueOrDefault(s.GroupId, new List<string>()),
                    // ThisCompanyClientId is repurposed here as "any
                    // member's clientId" — a representative we can hand
                    // to legacy save paths (POFormat) that still take
                    // a ClientId. The receiver auto-derives the group
                    // from this client's ClientGroupId.
                    ThisCompanyClientId = s.AnyClientId,
                })
                .OrderBy(c => c.DisplayName)
                .ToList();
        }

        public async Task<CommonClientDetailDto?> GetByIdAsync(int groupId, IReadOnlyCollection<int> accessibleCompanyIds)
        {
            // Members carry each sibling's full contact record (address,
            // phone, email, NTN, STRN, CNIC). Unscoped, this route handed
            // that to anyone who could guess a group id. Restricted to
            // reachable companies; when none are reachable we return null so
            // the controller 404s and a foreign group is indistinguishable
            // from one that doesn't exist.
            var allowed = accessibleCompanyIds as IReadOnlyCollection<int> ?? accessibleCompanyIds.ToList();
            if (allowed.Count == 0) return null;

            var group = await _db.ClientGroups.FirstOrDefaultAsync(g => g.Id == groupId);
            if (group == null) return null;

            var members = await _db.Clients
                .Where(c => c.ClientGroupId == groupId && allowed.Contains(c.CompanyId))
                .Select(c => new
                {
                    c.Id,
                    c.CompanyId,
                    CompanyName = c.Company.Name,
                    c.Site,
                    c.Name,
                    c.Address,
                    c.Phone,
                    c.Email,
                    c.NTN,
                    c.STRN,
                    c.CNIC,
                    c.RegistrationType,
                    c.FbrProvinceCode,
                })
                .ToListAsync();

            // No reachable member → treat as not found rather than throwing
            // on the representative lookup below.
            if (members.Count == 0) return null;

            // Master fields come from the FIRST member by Id — the backfill
            // and EnsureGroup paths keep the group's members in sync, so any
            // representative row carries the canonical values. We pick the
            // lowest Id deterministically so re-running ToDto on the same
            // data always produces the same output.
            var representative = members.OrderBy(m => m.Id).First();

            // Site is the exception: it's the field operators most
            // often forget to copy across tenants, so we pre-fill the
            // form from whichever member has the longest semicolon
            // list. That maximises information shown in the form
            // (operator can prune if they really want to clear sites
            // on save) and makes the cascade non-destructive in the
            // common case where exactly ONE tenant has sites entered.
            var bestSite = members
                .Select(m => m.Site)
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .OrderByDescending(s => s!.Length)
                .FirstOrDefault();

            // Has-invoices flag is per-Client; for the Common Client edit
            // form we only need to know if ANY member has invoices, since
            // that's what gates "this client can't be deleted".
            var memberClientIds = members.Select(m => m.Id).ToList();
            var hasInvoicesByClient = await _db.Invoices
                .Where(i => memberClientIds.Contains(i.ClientId))
                .Select(i => i.ClientId)
                .Distinct()
                .ToListAsync();

            return new CommonClientDetailDto
            {
                GroupId = group.Id,
                DisplayName = group.DisplayName,
                NTN = representative.NTN,
                STRN = representative.STRN,
                CNIC = representative.CNIC,
                Address = representative.Address,
                Phone = representative.Phone,
                Email = representative.Email,
                RegistrationType = representative.RegistrationType,
                FbrProvinceCode = representative.FbrProvinceCode,
                Site = bestSite,
                Members = members
                    .OrderBy(m => m.CompanyName)
                    .Select(m => new CommonClientMemberDto
                    {
                        ClientId = m.Id,
                        CompanyId = m.CompanyId,
                        CompanyName = m.CompanyName,
                        Site = m.Site,
                        HasInvoices = hasInvoicesByClient.Contains(m.Id),
                    })
                    .ToList(),
            };
        }

        public async Task<CommonClientUpdateResultDto> UpdateAsync(int groupId, CommonClientUpdateDto dto, IReadOnlyCollection<int> accessibleCompanyIds)
        {
            var group = await _db.ClientGroups.FirstOrDefaultAsync(g => g.Id == groupId)
                ?? throw new KeyNotFoundException("Common client group not found.");

            // Tenant scope (audit H8): only propagate master fields to sibling
            // clients in companies the caller can access — never overwrite another
            // tenant's client NTN/STRN/contact data via a shared common-client group.
            var allowed = new HashSet<int>(accessibleCompanyIds);
            var members = (await _db.Clients
                .Include(c => c.Company)
                .Where(c => c.ClientGroupId == groupId)
                .ToListAsync())
                .Where(c => allowed.Contains(c.CompanyId))
                .ToList();

            if (members.Count == 0)
                throw new InvalidOperationException("Common client group has no members you can edit.");

            // Propagate master fields to every sibling Client. Site is
            // included on purpose — sites are buyer-side master data
            // (physical departments at the buyer's plant), not seller
            // tenant data, and operators frequently forgot to copy the
            // list across companies. Pre-fill in GetByIdAsync uses the
            // longest existing site list so this overwrite is non-
            // destructive in the common case.
            foreach (var member in members)
            {
                member.Name = dto.Name;
                member.Address = dto.Address;
                member.Phone = dto.Phone;
                member.Email = dto.Email;
                member.NTN = dto.NTN;
                member.STRN = dto.STRN;
                member.CNIC = dto.CNIC;
                member.Site = dto.Site;
                member.RegistrationType = dto.RegistrationType;
                member.FbrProvinceCode = dto.FbrProvinceCode;
            }

            // The group's identity (GroupKey + NormalizedNtn / Name) might
            // change if the operator just corrected the NTN or fixed a
            // typo'd name. Re-compute and re-stamp the group row so future
            // EnsureGroup lookups land on the right key.
            var (newKey, newNtn, newName) = ComputeGroupKey(dto.Name, dto.NTN);
            if (newKey != group.GroupKey)
            {
                // If a DIFFERENT group already owns this key (e.g. operator
                // is fixing one entity's NTN to match another's), block —
                // merging is a deliberate operator action that needs its
                // own UI, not a side effect of an edit.
                var collision = await _db.ClientGroups
                    .FirstOrDefaultAsync(g => g.GroupKey == newKey && g.Id != group.Id);
                if (collision != null)
                {
                    throw new InvalidOperationException(
                        $"Another common client already uses NTN/name '{dto.NTN ?? dto.Name}'. " +
                        "Merge them via the configuration page first.");
                }
                group.GroupKey = newKey;
            }
            group.NormalizedNtn = newNtn;
            group.NormalizedName = newName;
            group.DisplayName = (dto.Name ?? "").Trim();
            group.UpdatedAt = DateTime.UtcNow;

            await _db.SaveChangesAsync();

            return new CommonClientUpdateResultDto
            {
                GroupId = group.Id,
                ClientsUpdated = members.Count,
                AffectedCompanyNames = members
                    .Select(m => m.Company?.Name ?? $"Company #{m.CompanyId}")
                    .Distinct()
                    .OrderBy(n => n)
                    .ToList(),
            };
        }

        public async Task<CommonClientUpdateResultDto> DeleteAsync(int groupId, IReadOnlyCollection<int> accessibleCompanyIds)
        {
            var group = await _db.ClientGroups.FirstOrDefaultAsync(g => g.Id == groupId)
                ?? throw new KeyNotFoundException("Common client group not found.");

            // Tenant scope (audit C2): only delete member clients in companies the
            // caller can access — NEVER cascade-delete another tenant's clients
            // (and their filed invoices/challans) via a shared common-client group.
            var allowed = new HashSet<int>(accessibleCompanyIds);
            var members = (await _db.Clients
                .Include(c => c.Company)
                .Where(c => c.ClientGroupId == groupId)
                .ToListAsync())
                .Where(c => allowed.Contains(c.CompanyId))
                .ToList();

            var companyNames = members
                .Select(m => m.Company?.Name ?? $"Company #{m.CompanyId}")
                .Distinct()
                .OrderBy(n => n)
                .ToList();

            // Delegate per-member delete to the existing ClientService
            // path — that already runs the full cascade (invoices,
            // invoice items, delivery items, challans) inside its own
            // transaction. Doing it once per member is N round-trips
            // but each is small and the safety of "exact same cascade
            // every tenant uses today" beats reinventing the cleanup.
            var clientService = _services.GetRequiredService<IClientService>();
            foreach (var member in members)
            {
                await clientService.DeleteAsync(member.Id);
            }

            // SetNull cascade on Client.ClientGroupId means the group
            // row is now orphaned — drop it explicitly so the dropdown
            // and the Common Clients panel refresh cleanly. Use a
            // fresh entity load (the prior reference may be stale
            // after the per-member deletes).
            // Only drop the group row when no members remain in ANY company —
            // scoped deletes may have left other tenants' members intact (audit C2).
            var groupRow = await _db.ClientGroups.FirstOrDefaultAsync(g => g.Id == groupId);
            var remaining = await _db.Clients.CountAsync(c => c.ClientGroupId == groupId);
            if (groupRow != null && remaining == 0)
            {
                _db.ClientGroups.Remove(groupRow);
                await _db.SaveChangesAsync();
            }

            return new CommonClientUpdateResultDto
            {
                GroupId = groupId,
                ClientsUpdated = members.Count,
                AffectedCompanyNames = companyNames,
            };
        }
    }
}
