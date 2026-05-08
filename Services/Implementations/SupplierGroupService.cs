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
    /// Mirror of <see cref="ClientGroupService"/>. Computes group keys,
    /// finds-or-creates groups on every Supplier save, lists multi-
    /// company groups, propagates updates across siblings, and cascade-
    /// deletes via the existing per-tenant SupplierService.DeleteAsync.
    /// </summary>
    public class SupplierGroupService : ISupplierGroupService
    {
        private readonly AppDbContext _db;
        // IServiceProvider breaks the circular DI between SupplierService
        // (depends on ISupplierGroupService for EnsureGroup on save) and
        // SupplierGroupService (depends on ISupplierService for cascade
        // delete) — same pattern as ClientGroupService.
        private readonly IServiceProvider _services;

        public SupplierGroupService(AppDbContext db, IServiceProvider services)
        {
            _db = db;
            _services = services;
        }

        // Same regex / threshold contract as ClientGroupService — keep
        // them identical so a row with the same NTN ends up in the
        // "same shape" of group on both sides.
        private static readonly Regex NonDigitRegex = new(@"\D", RegexOptions.Compiled);
        private static readonly Regex CollapseWhitespaceRegex = new(@"\s+", RegexOptions.Compiled);
        private const int MinNtnDigits = 7;

        public (string GroupKey, string? NormalizedNtn, string NormalizedName) ComputeGroupKey(string? name, string? ntn)
        {
            var normalizedName = CollapseWhitespaceRegex
                .Replace((name ?? "").Trim().ToLowerInvariant(), " ");

            var ntnDigits = NonDigitRegex.Replace(ntn ?? "", "");
            if (ntnDigits.Length >= MinNtnDigits)
                return ("NTN:" + ntnDigits, ntnDigits, normalizedName);

            return ("NAME:" + normalizedName, null, normalizedName);
        }

        public async Task<SupplierGroup> EnsureGroupForSupplierAsync(Supplier supplier)
        {
            var (key, ntn, name) = ComputeGroupKey(supplier.Name, supplier.NTN);

            var group = await _db.SupplierGroups.FirstOrDefaultAsync(g => g.GroupKey == key);
            if (group == null)
            {
                group = new SupplierGroup
                {
                    GroupKey = key,
                    DisplayName = (supplier.Name ?? "").Trim(),
                    NormalizedNtn = ntn,
                    NormalizedName = name,
                    CreatedAt = DateTime.UtcNow,
                    UpdatedAt = DateTime.UtcNow,
                };
                _db.SupplierGroups.Add(group);
                await _db.SaveChangesAsync();
            }
            else
            {
                // Refresh DisplayName to track the most-recently-saved
                // name. NormalizedNtn / Name change only when the
                // operator edits NTN / Name themselves (EnsureGroup is
                // invoked AFTER such edits so re-syncing is safe).
                group.DisplayName = (supplier.Name ?? "").Trim();
                group.UpdatedAt = DateTime.UtcNow;
            }

            supplier.SupplierGroupId = group.Id;
            return group;
        }

        public async Task<List<CommonSupplierDto>> GetCommonSuppliersAsync(int companyId)
        {
            // Multi-company groups visible to ANY company — same stable-
            // across-company-switches behaviour as Common Clients.
            // companyId is used only to compute ThisCompanyClientId for
            // the deep-link, NOT to filter the list.
            return await BuildGroupListAsync(multiCompanyOnly: true, companyId: companyId);
        }

        public async Task<List<CommonSupplierDto>> GetAllGroupsAsync()
        {
            // Every group, single + multi-company. Used by config screens
            // (purchase-side PO formats etc., when those land) that pick
            // one row per legal entity.
            return await BuildGroupListAsync(multiCompanyOnly: false, companyId: null);
        }

        private async Task<List<CommonSupplierDto>> BuildGroupListAsync(bool multiCompanyOnly, int? companyId)
        {
            var query = _db.Suppliers
                .Where(s => s.SupplierGroupId != null)
                .GroupBy(s => s.SupplierGroupId!.Value);

            if (multiCompanyOnly)
                query = query.Where(g => g.Select(s => s.CompanyId).Distinct().Count() >= 2);

            var summaries = await query
                .Select(g => new
                {
                    GroupId = g.Key,
                    CompanyCount = g.Select(s => s.CompanyId).Distinct().Count(),
                    ThisCompanyId = companyId.HasValue
                        ? g.Where(s => s.CompanyId == companyId.Value).Select(s => (int?)s.Id).FirstOrDefault()
                        : g.Select(s => (int?)s.Id).FirstOrDefault(),
                })
                .ToListAsync();

            if (summaries.Count == 0) return new List<CommonSupplierDto>();

            var groupIds = summaries.Select(s => s.GroupId).ToList();

            var groups = await _db.SupplierGroups
                .Where(g => groupIds.Contains(g.Id))
                .ToDictionaryAsync(g => g.Id);

            var memberCompanies = await _db.Suppliers
                .Where(s => s.SupplierGroupId != null && groupIds.Contains(s.SupplierGroupId!.Value))
                .Select(s => new { s.SupplierGroupId, s.Company.Name })
                .ToListAsync();
            var companyNamesByGroup = memberCompanies
                .GroupBy(x => x.SupplierGroupId!.Value)
                .ToDictionary(
                    g => g.Key,
                    g => g.Select(x => x.Name).Distinct().OrderBy(n => n).ToList());

            return summaries
                .Select(s => new CommonSupplierDto
                {
                    GroupId = s.GroupId,
                    DisplayName = groups[s.GroupId].DisplayName,
                    NTN = groups[s.GroupId].NormalizedNtn,
                    CompanyCount = s.CompanyCount,
                    CompanyNames = companyNamesByGroup.GetValueOrDefault(s.GroupId, new List<string>()),
                    ThisCompanyClientId = s.ThisCompanyId,  // see DTO comment — frontend reuse
                })
                .OrderBy(c => c.DisplayName)
                .ToList();
        }

        public async Task<CommonSupplierDetailDto?> GetByIdAsync(int groupId)
        {
            var group = await _db.SupplierGroups.FirstOrDefaultAsync(g => g.Id == groupId);
            if (group == null) return null;

            var members = await _db.Suppliers
                .Where(s => s.SupplierGroupId == groupId)
                .Select(s => new
                {
                    s.Id,
                    s.CompanyId,
                    CompanyName = s.Company.Name,
                    s.Site,
                    s.Name,
                    s.Address,
                    s.Phone,
                    s.Email,
                    s.NTN,
                    s.STRN,
                    s.CNIC,
                    s.RegistrationType,
                    s.FbrProvinceCode,
                })
                .ToListAsync();

            // Pick the lowest-Id member as representative (deterministic).
            var representative = members.OrderBy(m => m.Id).First();

            // Site pre-fills from the longest list across members so the
            // form never starts blank when at least one tenant has sites
            // configured. Same UX as the client side.
            var bestSite = members
                .Select(m => m.Site)
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .OrderByDescending(s => s!.Length)
                .FirstOrDefault();

            var memberSupplierIds = members.Select(m => m.Id).ToList();
            var hasBillsByMember = await _db.PurchaseBills
                .Where(pb => memberSupplierIds.Contains(pb.SupplierId))
                .Select(pb => pb.SupplierId)
                .Distinct()
                .ToListAsync();

            return new CommonSupplierDetailDto
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
                    .Select(m => new CommonSupplierMemberDto
                    {
                        SupplierId = m.Id,
                        CompanyId = m.CompanyId,
                        CompanyName = m.CompanyName,
                        Site = m.Site,
                        HasPurchaseBills = hasBillsByMember.Contains(m.Id),
                    })
                    .ToList(),
            };
        }

        public async Task<CommonSupplierUpdateResultDto> UpdateAsync(int groupId, CommonSupplierUpdateDto dto)
        {
            var group = await _db.SupplierGroups.FirstOrDefaultAsync(g => g.Id == groupId)
                ?? throw new KeyNotFoundException("Common supplier group not found.");

            var members = await _db.Suppliers
                .Include(s => s.Company)
                .Where(s => s.SupplierGroupId == groupId)
                .ToListAsync();

            if (members.Count == 0)
                throw new InvalidOperationException("Common supplier group has no members.");

            // Propagate every master field to every sibling Supplier.
            // Site is included on purpose — sees Common Clients commit.
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

            // Re-key the group if the operator just corrected NTN / Name.
            var (newKey, newNtn, newName) = ComputeGroupKey(dto.Name, dto.NTN);
            if (newKey != group.GroupKey)
            {
                var collision = await _db.SupplierGroups
                    .FirstOrDefaultAsync(g => g.GroupKey == newKey && g.Id != group.Id);
                if (collision != null)
                {
                    throw new InvalidOperationException(
                        $"Another common supplier already uses NTN/name '{dto.NTN ?? dto.Name}'. " +
                        "Merge them via the configuration page first.");
                }
                group.GroupKey = newKey;
            }
            group.NormalizedNtn = newNtn;
            group.NormalizedName = newName;
            group.DisplayName = (dto.Name ?? "").Trim();
            group.UpdatedAt = DateTime.UtcNow;

            await _db.SaveChangesAsync();

            return new CommonSupplierUpdateResultDto
            {
                GroupId = group.Id,
                SuppliersUpdated = members.Count,
                AffectedCompanyNames = members
                    .Select(m => m.Company?.Name ?? $"Company #{m.CompanyId}")
                    .Distinct()
                    .OrderBy(n => n)
                    .ToList(),
            };
        }

        public async Task<CommonSupplierUpdateResultDto> DeleteAsync(int groupId)
        {
            var group = await _db.SupplierGroups.FirstOrDefaultAsync(g => g.Id == groupId)
                ?? throw new KeyNotFoundException("Common supplier group not found.");

            var members = await _db.Suppliers
                .Include(s => s.Company)
                .Where(s => s.SupplierGroupId == groupId)
                .ToListAsync();

            var companyNames = members
                .Select(m => m.Company?.Name ?? $"Company #{m.CompanyId}")
                .Distinct()
                .OrderBy(n => n)
                .ToList();

            // Delegate per-member delete to ISupplierService — preserves
            // the existing "block delete if PurchaseBills exist" rule
            // tenant-by-tenant, and surfaces the first failure with a
            // clear company name in the message.
            var supplierService = _services.GetRequiredService<ISupplierService>();
            foreach (var member in members)
            {
                try
                {
                    await supplierService.DeleteAsync(member.Id);
                }
                catch (InvalidOperationException ex)
                {
                    throw new InvalidOperationException(
                        $"{member.Company?.Name ?? $"Company #{member.CompanyId}"}: {ex.Message}");
                }
            }

            var groupRow = await _db.SupplierGroups.FirstOrDefaultAsync(g => g.Id == groupId);
            if (groupRow != null)
            {
                _db.SupplierGroups.Remove(groupRow);
                await _db.SaveChangesAsync();
            }

            return new CommonSupplierUpdateResultDto
            {
                GroupId = groupId,
                SuppliersUpdated = members.Count,
                AffectedCompanyNames = companyNames,
            };
        }
    }
}
