using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <inheritdoc cref="IImportProfileService"/>
    public class ImportProfileService : IImportProfileService
    {
        private readonly AppDbContext _db;

        public ImportProfileService(AppDbContext db) => _db = db;

        // ── Reads ────────────────────────────────────────────────────────────

        public async Task<List<ImportProfileDto>> ListAsync(
            string? kind, int? companyId, IReadOnlyCollection<int> accessibleCompanyIds)
        {
            var allowed = accessibleCompanyIds.ToList();

            var q = _db.ImportProfiles.AsNoTracking()
                // Installation-wide profiles are visible to everyone; private
                // ones only to a company the caller can actually reach.
                .Where(p => p.CompanyId == null || allowed.Contains(p.CompanyId.Value));

            var canonicalKind = ImportKinds.Canonical(kind);
            if (kind != null)
            {
                // An unrecognised kind must return nothing rather than
                // everything — silently ignoring the filter would show a
                // stock profile in a ledger picker.
                if (canonicalKind == null) return new List<ImportProfileDto>();
                q = q.Where(p => p.Kind == canonicalKind);
            }

            if (companyId.HasValue)
                q = q.Where(p => p.CompanyId == null || p.CompanyId == companyId.Value);

            var rows = await q
                .OrderByDescending(p => p.UpdatedAt)
                .Select(p => new
                {
                    Profile = p,
                    CompanyName = p.Company != null ? p.Company.Name : null,
                })
                .ToListAsync();

            return rows.Select(r => ToDto(r.Profile, r.CompanyName)).ToList();
        }

        public async Task<ImportProfileDto?> GetAsync(int id)
        {
            var row = await _db.ImportProfiles.AsNoTracking()
                .Where(p => p.Id == id)
                .Select(p => new
                {
                    Profile = p,
                    CompanyName = p.Company != null ? p.Company.Name : null,
                })
                .FirstOrDefaultAsync();

            return row == null ? null : ToDto(row.Profile, row.CompanyName);
        }

        public async Task<bool> CanAccessAsync(int id, IReadOnlyCollection<int> accessibleCompanyIds)
        {
            var owner = await GetOwnerAsync(id);
            if (!owner.Found) return false;
            return owner.CompanyId == null || accessibleCompanyIds.Contains(owner.CompanyId.Value);
        }

        public async Task<(bool Found, int? CompanyId)> GetOwnerAsync(int id)
        {
            var row = await _db.ImportProfiles.AsNoTracking()
                .Where(p => p.Id == id)
                .Select(p => new { p.CompanyId })
                .FirstOrDefaultAsync();

            return row == null ? (false, null) : (true, row.CompanyId);
        }

        public async Task<List<ImportProfileVersionDto>> GetVersionsAsync(int id)
            => await _db.ImportProfileVersions.AsNoTracking()
                .Where(v => v.ImportProfileId == id)
                .OrderByDescending(v => v.Version)
                .Select(v => new ImportProfileVersionDto
                {
                    Id = v.Id,
                    Version = v.Version,
                    Layout = v.Layout,
                    MappingJson = v.MappingJson,
                    ChangeNote = v.ChangeNote,
                    CreatedBy = v.CreatedBy,
                    CreatedAt = v.CreatedAt,
                })
                .ToListAsync();

        // ── Writes ───────────────────────────────────────────────────────────

        public async Task<ImportProfileDto> CreateAsync(CreateImportProfileDto dto, string? userName)
        {
            var kind = ImportKinds.Canonical(dto.Kind)
                ?? throw new InvalidOperationException("Unknown import kind.");

            if (!ImportLayouts.IsValidFor(kind, dto.Layout))
                throw new InvalidOperationException($"'{dto.Layout}' is not a layout for {kind} imports.");

            if (string.IsNullOrWhiteSpace(dto.Name))
                throw new InvalidOperationException("Give the layout a name.");

            if (string.IsNullOrWhiteSpace(dto.SignatureHash))
                throw new InvalidOperationException(
                    "The layout has no signature, so it could never be matched again. Re-upload the file and try again.");

            var mapping = NormaliseMapping(dto.MappingJson);
            var layout = CanonicalLayout(kind, dto.Layout);

            var profile = new ImportProfile
            {
                Kind = kind,
                Layout = layout,
                Name = dto.Name.Trim(),
                CompanyId = dto.CompanyId,
                SignatureHash = dto.SignatureHash.Trim().ToLowerInvariant(),
                TokenSignature = Truncate(dto.TokenSignature, 4000) ?? "",
                MappingJson = mapping,
                CurrentVersion = 1,
                IsActive = true,
                Notes = Truncate(dto.Notes, 2000),
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            };

            _db.ImportProfiles.Add(profile);
            await _db.SaveChangesAsync();

            _db.ImportProfileVersions.Add(new ImportProfileVersion
            {
                ImportProfileId = profile.Id,
                Version = 1,
                Layout = layout,
                MappingJson = mapping,
                ChangeNote = "Created",
                CreatedBy = userName,
            });
            await _db.SaveChangesAsync();

            return ToDto(profile, null);
        }

        public async Task<ImportProfileDto?> UpdateAsync(int id, UpdateImportProfileDto dto, string? userName)
        {
            var profile = await _db.ImportProfiles.FirstOrDefaultAsync(p => p.Id == id);
            if (profile == null) return null;

            // A version is only worth writing when a RULE changed. Renaming a
            // profile or toggling IsActive changes nothing about how a file is
            // read, and versioning those would bury the edits that matter.
            var ruleChanged = false;

            if (dto.Layout != null)
            {
                if (!ImportLayouts.IsValidFor(profile.Kind, dto.Layout))
                    throw new InvalidOperationException($"'{dto.Layout}' is not a layout for {profile.Kind} imports.");

                var layout = CanonicalLayout(profile.Kind, dto.Layout);
                if (!string.Equals(layout, profile.Layout, StringComparison.Ordinal))
                {
                    profile.Layout = layout;
                    ruleChanged = true;
                }
            }

            if (dto.MappingJson != null)
            {
                var mapping = NormaliseMapping(dto.MappingJson);
                if (!string.Equals(mapping, profile.MappingJson, StringComparison.Ordinal))
                {
                    profile.MappingJson = mapping;
                    ruleChanged = true;
                }
            }

            if (dto.SignatureHash != null && !string.IsNullOrWhiteSpace(dto.SignatureHash))
                profile.SignatureHash = dto.SignatureHash.Trim().ToLowerInvariant();
            if (dto.TokenSignature != null)
                profile.TokenSignature = Truncate(dto.TokenSignature, 4000) ?? "";
            if (dto.Name != null && !string.IsNullOrWhiteSpace(dto.Name))
                profile.Name = dto.Name.Trim();
            if (dto.IsActive.HasValue)
                profile.IsActive = dto.IsActive.Value;
            if (dto.Notes != null)
                profile.Notes = Truncate(dto.Notes, 2000);

            profile.UpdatedAt = DateTime.UtcNow;

            if (ruleChanged)
            {
                profile.CurrentVersion += 1;
                _db.ImportProfileVersions.Add(new ImportProfileVersion
                {
                    ImportProfileId = profile.Id,
                    Version = profile.CurrentVersion,
                    Layout = profile.Layout,
                    MappingJson = profile.MappingJson,
                    ChangeNote = Truncate(dto.ChangeNote, 1000),
                    CreatedBy = userName,
                });
            }

            await _db.SaveChangesAsync();
            return await GetAsync(profile.Id);
        }

        public async Task<ImportProfileDto?> RollbackAsync(
            int id, RollbackImportProfileDto dto, string? userName)
        {
            var profile = await _db.ImportProfiles.FirstOrDefaultAsync(p => p.Id == id);
            if (profile == null) return null;

            var target = await _db.ImportProfileVersions.AsNoTracking()
                .FirstOrDefaultAsync(v => v.ImportProfileId == id && v.Version == dto.Version);
            if (target == null)
                throw new InvalidOperationException($"Version {dto.Version} does not exist for this layout.");

            // Copy forward rather than rewinding CurrentVersion: the history has
            // to show that a rollback happened, and rewinding would collide with
            // the unique (profile, version) index on the next edit.
            profile.Layout = target.Layout;
            profile.MappingJson = target.MappingJson;
            profile.CurrentVersion += 1;
            profile.UpdatedAt = DateTime.UtcNow;

            _db.ImportProfileVersions.Add(new ImportProfileVersion
            {
                ImportProfileId = profile.Id,
                Version = profile.CurrentVersion,
                Layout = target.Layout,
                MappingJson = target.MappingJson,
                ChangeNote = Truncate(dto.ChangeNote, 1000) ?? $"Rolled back to version {dto.Version}",
                CreatedBy = userName,
            });

            await _db.SaveChangesAsync();
            return await GetAsync(profile.Id);
        }

        public async Task<bool> DeleteAsync(int id)
        {
            var profile = await _db.ImportProfiles.FirstOrDefaultAsync(p => p.Id == id);
            if (profile == null) return false;

            // Versions cascade. ImportRun keeps a nullable ImportProfileId on
            // purpose, so deleting a layout never takes the audit trail of what
            // it imported with it.
            _db.ImportProfiles.Remove(profile);
            await _db.SaveChangesAsync();
            return true;
        }

        // ── Helpers ──────────────────────────────────────────────────────────

        /// <summary>
        /// Proves the mapping is real JSON before it is stored. A malformed
        /// mapping would otherwise sit in the table until an import ran against
        /// it and failed somewhere far less obvious.
        /// </summary>
        private static string NormaliseMapping(string? mappingJson)
        {
            var raw = string.IsNullOrWhiteSpace(mappingJson) ? "{}" : mappingJson.Trim();
            try
            {
                using var doc = JsonDocument.Parse(raw);
                if (doc.RootElement.ValueKind != JsonValueKind.Object)
                    throw new InvalidOperationException("The column mapping must be a JSON object.");
                return raw;
            }
            catch (JsonException)
            {
                throw new InvalidOperationException("The column mapping is not valid JSON.");
            }
        }

        /// <summary>Layout name in its registered casing, so a caller sending
        /// "lotrows" stores the same value the strategy lookup expects.</summary>
        private static string CanonicalLayout(string kind, string? layout)
            => ImportLayouts.ByKind[kind]
                .First(l => string.Equals(l, layout?.Trim(), StringComparison.OrdinalIgnoreCase));

        private static string? Truncate(string? value, int max)
        {
            if (value == null) return null;
            var trimmed = value.Trim();
            return trimmed.Length <= max ? trimmed : trimmed[..max];
        }

        private static ImportProfileDto ToDto(ImportProfile p, string? companyName) => new()
        {
            Id = p.Id,
            Kind = p.Kind,
            Layout = p.Layout,
            Name = p.Name,
            CompanyId = p.CompanyId,
            CompanyName = companyName,
            IsShared = p.CompanyId == null,
            SignatureHash = p.SignatureHash,
            MappingJson = p.MappingJson,
            CurrentVersion = p.CurrentVersion,
            IsActive = p.IsActive,
            Notes = p.Notes,
            CreatedAt = p.CreatedAt,
            UpdatedAt = p.UpdatedAt,
        };
    }
}
