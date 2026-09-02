using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;
using MyApp.Api.Services.Tax;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// Owns the local HS / PCT master and its import.
    ///
    /// SEPARATION OF CONCERNS (the whole point of this service):
    ///   • HS code master data = reference data every company needs in order to
    ///     classify item types. Readable and importable with FBR integration OFF.
    ///   • FBR integration (<see cref="Company.FbrEnabled"/>) = whether a company
    ///     actually submits invoices to FBR. Untouched by anything here.
    ///
    /// The import is an UPSERT keyed on <see cref="HsCode.Code"/>, so pressing
    /// the button twice is harmless: existing codes keep their row (and their
    /// Item Type links), only genuinely new codes are inserted. It never deletes:
    /// a code FBR stops publishing keeps its row so historical documents that
    /// reference it stay readable.
    /// </summary>
    public class HsCodeService : IHsCodeService
    {
        private readonly AppDbContext _db;
        private readonly IFbrService _fbr;
        private readonly ITaxMappingEngine _taxEngine;
        private readonly IFbrTokenProtector _protector;
        private readonly ILogger<HsCodeService> _logger;

        // FBR's Annexure-A id — the same constant the tax engine uses for HS_UOM.
        private const int DefaultAnnexureId = 3;

        // Rows per SaveChanges during a bulk import. FBR's catalog is ~14k rows;
        // one giant SaveChanges builds an enormous command batch and holds a
        // single long transaction, so we commit in chunks instead.
        private const int ChunkSize = 500;

        // Cap on the error list returned to the client — a systematically bad
        // feed must not turn into a megabyte of JSON.
        private const int MaxReportedErrors = 25;

        /// <summary>Codes looked up per backfill call. FBR answers one code per
        /// request, so a bigger batch just means a longer-running request and
        /// more chance of tripping PRAL's throttling.</summary>
        private const int MaxUomBackfillBatch = 300;

        public HsCodeService(
            AppDbContext db,
            IFbrService fbr,
            ITaxMappingEngine taxEngine,
            IFbrTokenProtector protector,
            ILogger<HsCodeService> logger)
        {
            _db = db;
            _fbr = fbr;
            _taxEngine = taxEngine;
            _protector = protector;
            _logger = logger;
        }

        // ─────────────────────────────────────────────────────────────
        //  Reads — no FBR involvement whatsoever
        // ─────────────────────────────────────────────────────────────

        public async Task<List<HsCodeDto>> SearchAsync(string? search, int take, bool activeOnly = true)
        {
            take = take <= 0 ? 50 : Math.Min(take, 200);

            var query = _db.HsCodes.AsNoTracking().AsQueryable();
            if (activeOnly) query = query.Where(h => h.IsActive);

            var term = search?.Trim();
            if (!string.IsNullOrEmpty(term))
            {
                // Code matches are prefix-based (operators type "6109"), description
                // matches are substring ("cotton t-shirt"). EF translates both to
                // SQL LIKE, so the work stays in the database.
                query = query.Where(h =>
                    EF.Functions.Like(h.Code, term + "%") ||
                    (h.Description != null && EF.Functions.Like(h.Description, "%" + term + "%")));
            }

            var rows = await query
                .OrderBy(h => h.Code)
                .Take(take)
                .ToListAsync();

            // Attach the Item Type each code already maps to, so the picker can
            // say "already mapped to Cotton T-Shirt" instead of letting the
            // operator create a second row for the same code.
            var codes = rows.Select(r => r.Code).ToList();
            var mapped = await _db.ItemTypes.AsNoTracking()
                .Where(it => !it.IsDeleted && it.HSCode != null && codes.Contains(it.HSCode))
                .Select(it => new { it.Id, it.Name, it.HSCode })
                .ToListAsync();

            var byCode = mapped
                .GroupBy(m => m.HSCode!, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

            return rows.Select(r =>
            {
                var dto = ToDto(r);
                if (byCode.TryGetValue(r.Code, out var it))
                {
                    dto.ItemTypeId = it.Id;
                    dto.ItemTypeName = it.Name;
                }
                return dto;
            }).ToList();
        }

        public async Task<HsCodeDto?> GetByCodeAsync(string code)
        {
            if (string.IsNullOrWhiteSpace(code)) return null;
            var trimmed = code.Trim();
            var row = await _db.HsCodes.AsNoTracking()
                .FirstOrDefaultAsync(h => h.Code == trimmed);
            return row == null ? null : ToDto(row);
        }

        public Task<int> CountAsync() => _db.HsCodes.CountAsync(h => h.IsActive);

        // ─────────────────────────────────────────────────────────────
        //  UOMs for one code — master first, FBR only to fill a gap
        // ─────────────────────────────────────────────────────────────

        public async Task<List<FbrUOMDto>> GetUomsForCodeAsync(string code, int? companyId)
        {
            if (string.IsNullOrWhiteSpace(code)) return new();
            var trimmed = code.Trim();

            var row = await _db.HsCodes.FirstOrDefaultAsync(h => h.Code == trimmed);

            // Known locally → answer without touching FBR. This is what makes the
            // Item Type form work for a company with FBR integration off.
            if (row?.FbrUomId != null && !string.IsNullOrWhiteSpace(row.Uom))
                return new List<FbrUOMDto> { new() { UOM_ID = row.FbrUomId.Value, Description = row.Uom! } };

            // Not known yet: ask FBR once, then remember the answer on the master
            // row so no later caller needs FBR for this code.
            List<FbrUOMDto> fresh = new();
            try
            {
                if (companyId.HasValue)
                {
                    fresh = await _taxEngine.GetValidUomsForHsCodeAsync(companyId.Value, trimmed);
                }
                if (fresh.Count == 0)
                {
                    var token = await GetReferenceTokenAsync();
                    if (!string.IsNullOrWhiteSpace(token))
                        fresh = await _fbr.FetchHsCodeUomWithTokenAsync(token!, trimmed, DefaultAnnexureId);
                }
            }
            catch (Exception ex)
            {
                // Non-fatal: the operator can still pick a UOM by hand.
                _logger.LogWarning(ex, "HS_UOM lookup failed for {HsCode}", trimmed);
            }

            if (fresh.Count > 0 && row != null)
            {
                var first = fresh[0];
                row.Uom = first.Description;
                row.FbrUomId = first.UOM_ID;
                row.UpdatedAt = DateTime.UtcNow;
                await UnitRegistry.EnsureNamesAsync(_db, new[] { first.Description });
                await _db.SaveChangesAsync();
            }

            return fresh;
        }

        // ─────────────────────────────────────────────────────────────
        //  Import — the "Import HS Codes" button
        // ─────────────────────────────────────────────────────────────

        public async Task<HsCodeImportResultDto> ImportAsync(int? companyId, bool createItemTypes, int userId)
        {
            var result = new HsCodeImportResultDto();

            var (token, source) = await ResolveImportTokenAsync(companyId);
            if (string.IsNullOrWhiteSpace(token))
            {
                result.Errors.Add(
                    "No FBR token is available to read the tariff catalog. Paste an FBR reference token " +
                    "on this screen (it is used only to read HS codes and UOMs — it does not enable FBR " +
                    "invoice submission for any company), or select a company that already has its own token.");
                return result;
            }
            result.Source = source;

            var feed = await _fbr.FetchHsCodeCatalogWithTokenAsync(token!);
            result.TotalReceived = feed.Count;
            if (feed.Count == 0)
            {
                result.Errors.Add(
                    "FBR returned no HS codes. The token may be expired or FBR's catalog service may be down. " +
                    "Nothing was changed locally.");
                return result;
            }

            // ── Normalise + de-duplicate the feed ──────────────────────────
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var incoming = new List<(string Code, string? Description)>();
            foreach (var row in feed)
            {
                var code = row.HS_CODE?.Trim();
                if (string.IsNullOrWhiteSpace(code))
                {
                    result.Skipped++;
                    AddError(result, "A row arrived with a blank HS code and was skipped.");
                    continue;
                }
                if (!seen.Add(code))
                {
                    // FBR's feed repeats codes across annexures; not an error.
                    result.Skipped++;
                    continue;
                }
                incoming.Add((code, string.IsNullOrWhiteSpace(row.Description) ? null : row.Description.Trim()));
            }

            await UpsertAsync(incoming, "FBR", createItemTypes, result);

            _logger.LogInformation(
                "HS code import by user {UserId} via {Source}: received {Received}, added {Added}, existing {Existing}, item types {ItemTypes}",
                userId, source, result.TotalReceived, result.Added, result.AlreadyExisting, result.ItemTypesCreated);

            result.CompletedAt = DateTime.UtcNow;
            return result;
        }

        /// <summary>
        /// Load the HS master from the Pakistan Customs Tariff that ships with
        /// the product. No FBR token, no network call.
        ///
        /// PRAL's catalog endpoints answer 401 without an OAuth token, so a
        /// company that has not been issued one cannot classify its items at
        /// all — which contradicts the rule that HS classification must never
        /// depend on FBR. FBR publishes the tariff itself as an open PDF, and
        /// scripts/build_hscode_dataset.py turns that into the embedded dataset
        /// this reads.
        ///
        /// It carries NO units: the tariff has no unit column. Rows land with a
        /// null UOM, which <see cref="GetUomsForCodeAsync"/> fills in later the
        /// first time someone asks for a code's UOMs with a token available.
        /// Prefer <see cref="ImportAsync"/> when a token exists — FBR's own feed
        /// is what its validation is built on.
        /// </summary>
        public async Task<HsCodeImportResultDto> ImportFromTariffAsync(bool createItemTypes, int userId)
        {
            var result = new HsCodeImportResultDto();

            List<(string Code, string? Description)> incoming;
            string edition;
            try
            {
                (incoming, edition) = BundledTariff.Read();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Reading the bundled customs tariff failed");
                result.Errors.Add("The bundled customs tariff could not be read. See the server log.");
                return result;
            }

            result.Source = edition;
            result.TotalReceived = incoming.Count;
            if (incoming.Count == 0)
            {
                result.Errors.Add("The bundled customs tariff is empty. Nothing was changed.");
                return result;
            }

            await UpsertAsync(incoming, "Tariff", createItemTypes, result);

            _logger.LogInformation(
                "HS code import by user {UserId} from the bundled tariff ({Edition}): received {Received}, added {Added}, existing {Existing}, item types {ItemTypes}",
                userId, edition, result.TotalReceived, result.Added, result.AlreadyExisting, result.ItemTypesCreated);

            result.CompletedAt = DateTime.UtcNow;
            return result;
        }

        /// <summary>
        /// The shared write half of both imports: upsert the codes, link Item
        /// Types that already carry one, and optionally create a placeholder per
        /// unmapped code.
        ///
        /// <paramref name="source"/> is stamped on rows this call CREATES only.
        /// An existing row keeps the source that first introduced it, so loading
        /// the bundled tariff over a master FBR populated does not rewrite its
        /// provenance.
        /// </summary>
        private async Task UpsertAsync(
            List<(string Code, string? Description)> incoming,
            string source,
            bool createItemTypes,
            HsCodeImportResultDto result)
        {
            // ── Upsert against what we already hold ────────────────────────
            var existing = await _db.HsCodes
                .ToDictionaryAsync(h => h.Code, h => h, StringComparer.OrdinalIgnoreCase);

            var now = DateTime.UtcNow;
            var pending = 0;
            var autoDetect = _db.ChangeTracker.AutoDetectChangesEnabled;
            _db.ChangeTracker.AutoDetectChangesEnabled = false;
            try
            {
                foreach (var item in incoming)
                {
                    if (existing.TryGetValue(item.Code, out var row))
                    {
                        // Requirement 3: an existing code KEEPS its row. We only
                        // refresh the description FBR now publishes and stamp the
                        // sync time — the Id, and therefore every ItemType link,
                        // survives.
                        result.AlreadyExisting++;
                        var descriptionChanged =
                            item.Description != null &&
                            !string.Equals(row.Description, item.Description, StringComparison.Ordinal);
                        if (descriptionChanged) { row.Description = item.Description; result.Updated++; }
                        if (!row.IsActive) { row.IsActive = true; }
                        row.LastSyncedAt = now;
                        if (descriptionChanged) row.UpdatedAt = now;
                        _db.Entry(row).State = EntityState.Modified;
                    }
                    else
                    {
                        var fresh = new HsCode
                        {
                            Code = item.Code,
                            Description = item.Description,
                            IsActive = true,
                            Source = source,
                            LastSyncedAt = now,
                            CreatedAt = now,
                            UpdatedAt = now,
                        };
                        _db.HsCodes.Add(fresh);
                        existing[item.Code] = fresh;
                        result.Added++;
                    }

                    if (++pending >= ChunkSize)
                    {
                        await _db.SaveChangesAsync();
                        pending = 0;
                    }
                }
                if (pending > 0) await _db.SaveChangesAsync();
            }
            finally
            {
                _db.ChangeTracker.AutoDetectChangesEnabled = autoDetect;
            }

            // ── Link Item Types that already carry one of these codes ──────
            await LinkExistingItemTypesAsync();

            // ── Requirement 4: a placeholder Item Type per unmapped code ───
            if (createItemTypes)
            {
                try
                {
                    result.ItemTypesCreated = await CreatePlaceholderItemTypesAsync();
                }
                catch (Exception ex)
                {
                    // The HS master is already saved at this point — a failure
                    // here must not throw the import away.
                    _logger.LogError(ex, "HS import: placeholder Item Type creation failed");
                    AddError(result, "HS codes were imported, but creating placeholder Item Types failed. "
                                   + "Run the import again to finish that step.");
                }
            }
        }

        /// <inheritdoc/>
        public async Task<HsUomBackfillResultDto> BackfillUomsAsync(
            int? companyId, int max, bool onlyInUse, int userId)
        {
            var result = new HsUomBackfillResultDto();

            var (token, _) = await ResolveImportTokenAsync(companyId);
            if (string.IsNullOrWhiteSpace(token))
            {
                result.Errors.Add(
                    "No FBR token is available, so units cannot be looked up. Paste an FBR reference token on this screen first — it is used only to read reference data.");
                return result;
            }

            var pending = _db.HsCodes.Where(h => h.IsActive && (h.Uom == null || h.Uom == ""));

            // "Only the codes actually in use" is the cheap, high-value subset:
            // the ones an item type already references. A full walk is thousands
            // of calls; this is usually a few dozen.
            if (onlyInUse)
            {
                var used = _db.ItemTypes
                    .Where(t => !t.IsDeleted && t.HSCode != null && t.HSCode != "")
                    .Select(t => t.HSCode!);
                pending = pending.Where(h => used.Contains(h.Code));
            }

            result.Missing = await pending.CountAsync();

            var batch = await pending
                .OrderBy(h => h.Code)
                .Take(Math.Clamp(max, 1, MaxUomBackfillBatch))
                .ToListAsync();

            foreach (var row in batch)
            {
                result.Attempted++;
                try
                {
                    var uoms = await _fbr.FetchHsCodeUomWithTokenAsync(token!, row.Code, DefaultAnnexureId);
                    if (uoms is { Count: > 0 })
                    {
                        var first = uoms[0];
                        row.Uom = first.Description;
                        row.FbrUomId = first.UOM_ID;
                        row.UpdatedAt = DateTime.UtcNow;
                        await UnitRegistry.EnsureNamesAsync(_db, new[] { first.Description });
                        result.Filled++;
                    }
                    else
                    {
                        // A real answer: FBR restricts no unit for this code.
                        result.NoUnitPublished++;
                    }
                }
                catch (Exception ex)
                {
                    result.Failed++;
                    if (result.Errors.Count < 5)
                        result.Errors.Add($"{row.Code}: {ex.GetType().Name}");
                    _logger.LogWarning(ex, "UOM backfill failed for {HsCode}", row.Code);
                }
            }

            if (result.Filled > 0) await _db.SaveChangesAsync();

            result.RemainingWithoutUom = Math.Max(0, result.Missing - result.Filled - result.NoUnitPublished);
            result.CompletedAt = DateTime.UtcNow;

            _logger.LogInformation(
                "UOM backfill by user {UserId}: attempted {Attempted}, filled {Filled}, no-unit {NoUnit}, failed {Failed}, remaining {Remaining}",
                userId, result.Attempted, result.Filled, result.NoUnitPublished, result.Failed, result.RemainingWithoutUom);

            return result;
        }

        /// <summary>
        /// Back-fill <see cref="ItemType.HsCodeId"/> for catalog rows that were
        /// created before the master existed. Pure link-up: no name, HS code or
        /// UOM on the Item Type is touched.
        /// </summary>
        private async Task LinkExistingItemTypesAsync()
        {
            var unlinked = await _db.ItemTypes
                .Where(it => !it.IsDeleted && it.HsCodeId == null && it.HSCode != null && it.HSCode != "")
                .ToListAsync();
            if (unlinked.Count == 0) return;

            var codes = unlinked.Select(it => it.HSCode!).Distinct().ToList();
            var master = await _db.HsCodes
                .Where(h => codes.Contains(h.Code))
                .ToDictionaryAsync(h => h.Code, h => h.Id, StringComparer.OrdinalIgnoreCase);

            var linked = 0;
            foreach (var it in unlinked)
            {
                if (master.TryGetValue(it.HSCode!, out var hsId))
                {
                    it.HsCodeId = hsId;
                    linked++;
                }
            }
            if (linked > 0) await _db.SaveChangesAsync();
        }

        /// <summary>
        /// Create an Item Type for every master code that has none, named
        /// "HS Code &lt;code&gt;" as a placeholder the operator renames later.
        ///
        /// They are created with IsFavorite = false and IsAutoGenerated = true:
        /// ItemType is a GLOBAL catalog shared by every tenant, so 14k visible
        /// rows would make the bill and challan pickers unusable. The Item Types
        /// admin page still lists them, and renaming one keeps its HS code.
        /// </summary>
        private async Task<int> CreatePlaceholderItemTypesAsync()
        {
            // Codes that already have a catalog row — matched on the HS code
            // string, which is what every existing ItemType carries.
            var mappedCodes = await _db.ItemTypes
                .Where(it => !it.IsDeleted && it.HSCode != null && it.HSCode != "")
                .Select(it => it.HSCode!)
                .Distinct()
                .ToListAsync();
            var mapped = new HashSet<string>(mappedCodes, StringComparer.OrdinalIgnoreCase);

            var unmapped = await _db.HsCodes
                .Where(h => h.IsActive)
                .Select(h => new { h.Id, h.Code, h.Description, h.Uom, h.FbrUomId })
                .ToListAsync();

            // Placeholder names must also clear the (Name, HSCode) unique index,
            // so skip a name some other row already uses.
            var takenNames = new HashSet<string>(
                await _db.ItemTypes.Where(it => !it.IsDeleted).Select(it => it.Name).ToListAsync(),
                StringComparer.OrdinalIgnoreCase);

            var now = DateTime.UtcNow;
            var created = 0;
            var pending = 0;
            var autoDetect = _db.ChangeTracker.AutoDetectChangesEnabled;
            _db.ChangeTracker.AutoDetectChangesEnabled = false;
            try
            {
                foreach (var h in unmapped)
                {
                    if (mapped.Contains(h.Code)) continue;

                    var name = $"HS Code {h.Code}";
                    if (!takenNames.Add(name)) continue;

                    _db.ItemTypes.Add(new ItemType
                    {
                        Name = name,
                        HSCode = h.Code,
                        HsCodeId = h.Id,
                        UOM = h.Uom,
                        FbrUOMId = h.FbrUomId,
                        FbrDescription = h.Description,
                        IsFavorite = false,
                        IsAutoGenerated = true,
                        CreatedAt = now,
                    });
                    created++;

                    if (++pending >= ChunkSize)
                    {
                        await _db.SaveChangesAsync();
                        pending = 0;
                    }
                }
                if (pending > 0) await _db.SaveChangesAsync();
            }
            finally
            {
                _db.ChangeTracker.AutoDetectChangesEnabled = autoDetect;
            }

            return created;
        }

        // ─────────────────────────────────────────────────────────────
        //  Reference token
        // ─────────────────────────────────────────────────────────────

        public async Task<FbrReferenceTokenStatusDto> GetReferenceTokenStatusAsync()
        {
            var token = await GetReferenceTokenAsync();
            var envRow = await _db.SystemSettings.AsNoTracking()
                .FirstOrDefaultAsync(s => s.Key == SystemSettingKeys.FbrReferenceEnvironment);
            var tokenRow = await _db.SystemSettings.AsNoTracking()
                .FirstOrDefaultAsync(s => s.Key == SystemSettingKeys.FbrReferenceToken);

            return new FbrReferenceTokenStatusDto
            {
                IsConfigured = !string.IsNullOrWhiteSpace(token),
                // Last 4 characters only — enough for an operator to recognise
                // which token is installed, useless to anyone who steals the response.
                Preview = string.IsNullOrWhiteSpace(token) || token!.Length < 4
                    ? null
                    : "••••" + token[^4..],
                Environment = string.IsNullOrWhiteSpace(envRow?.Value) ? "production" : envRow!.Value!,
                UpdatedAt = tokenRow?.UpdatedAt,
                HasCompanyTokenFallback = await _db.Companies
                    .AnyAsync(c => c.FbrToken != null && c.FbrToken != ""),
            };
        }

        public async Task SetReferenceTokenAsync(string token, string? environment, int userId)
        {
            if (string.IsNullOrWhiteSpace(token))
                throw new InvalidOperationException("Token is required.");

            var env = string.Equals(environment, "sandbox", StringComparison.OrdinalIgnoreCase)
                ? "sandbox" : "production";

            await UpsertSettingAsync(
                SystemSettingKeys.FbrReferenceToken,
                _protector.Protect(token.Trim()),
                isSensitive: true,
                userId);
            await UpsertSettingAsync(
                SystemSettingKeys.FbrReferenceEnvironment, env, isSensitive: false, userId);

            await _db.SaveChangesAsync();
        }

        private async Task UpsertSettingAsync(string key, string? value, bool isSensitive, int userId)
        {
            var row = await _db.SystemSettings.FirstOrDefaultAsync(s => s.Key == key);
            if (row == null)
            {
                _db.SystemSettings.Add(new SystemSetting
                {
                    Key = key,
                    Value = value,
                    IsSensitive = isSensitive,
                    UpdatedAt = DateTime.UtcNow,
                    UpdatedByUserId = userId,
                });
                return;
            }
            row.Value = value;
            row.IsSensitive = isSensitive;
            row.UpdatedAt = DateTime.UtcNow;
            row.UpdatedByUserId = userId;
        }

        /// <summary>Decrypted installation-wide reference token, or null.</summary>
        private async Task<string?> GetReferenceTokenAsync()
        {
            var row = await _db.SystemSettings.AsNoTracking()
                .FirstOrDefaultAsync(s => s.Key == SystemSettingKeys.FbrReferenceToken);
            if (row == null || string.IsNullOrWhiteSpace(row.Value)) return null;
            return _protector.Unprotect(row.Value);
        }

        /// <summary>
        /// Pick the credentials the import runs under. The installation-wide
        /// reference token wins; only if it is absent do we fall back to the
        /// token of the company the caller explicitly chose (never some other
        /// tenant's — audit H-9).
        /// </summary>
        private async Task<(string? Token, string Source)> ResolveImportTokenAsync(int? companyId)
        {
            var reference = await GetReferenceTokenAsync();
            if (!string.IsNullOrWhiteSpace(reference))
                return (reference, "FBR (reference token)");

            if (companyId.HasValue)
            {
                var company = await _db.Companies.AsNoTracking()
                    .FirstOrDefaultAsync(c => c.Id == companyId.Value);
                if (!string.IsNullOrWhiteSpace(company?.FbrToken))
                    return (company!.FbrToken, $"FBR (token of {company.Name})");
            }

            return (null, "");
        }

        private static void AddError(HsCodeImportResultDto result, string message)
        {
            if (result.Errors.Count < MaxReportedErrors && !result.Errors.Contains(message))
                result.Errors.Add(message);
        }

        private static HsCodeDto ToDto(HsCode h) => new()
        {
            Id = h.Id,
            Code = h.Code,
            Description = h.Description,
            Uom = h.Uom,
            FbrUomId = h.FbrUomId,
            IsActive = h.IsActive,
            Source = h.Source,
            LastSyncedAt = h.LastSyncedAt,
        };
    }
}
