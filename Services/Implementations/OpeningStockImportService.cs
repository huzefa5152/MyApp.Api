using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Helpers.ExcelImport;
using MyApp.Api.Models;
using MyApp.Api.Models.Accounting;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <inheritdoc cref="IOpeningStockImportService"/>
    public class OpeningStockImportService : IOpeningStockImportService
    {
        private readonly AppDbContext _db;
        private readonly IAccountService _accounts;
        private readonly ISpreadsheetImportService _imports;
        private readonly ILogger<OpeningStockImportService> _logger;

        /// <summary>A stock sheet with more rows than this is not a stock
        /// sheet. Keeps a malformed mapping from walking an entire workbook.</summary>
        public const int MaxSourceRows = 5000;

        public OpeningStockImportService(
            AppDbContext db,
            IAccountService accounts,
            ISpreadsheetImportService imports,
            ILogger<OpeningStockImportService> logger)
        {
            _db = db;
            _accounts = accounts;
            _imports = imports;
            _logger = logger;
        }

        // ── Preview ──────────────────────────────────────────────────────────

        public async Task<OpeningStockPreviewDto> PreviewAsync(
            byte[] bytes, string extension, string fileName, string fileSha256,
            string mappingJson, int companyId, int? profileId, int? profileVersion)
        {
            var mapping = LotRowsMapping.Parse(mappingJson);

            var preview = new OpeningStockPreviewDto
            {
                FileName = fileName,
                FileSha256 = fileSha256,
                FileSizeBytes = bytes.LongLength,
                ImportProfileId = profileId,
                ProfileVersion = profileVersion,
            };

            var lots = ReadLots(bytes, extension, mapping, preview);
            if (preview.BlockingErrors.Count > 0) return preview;

            preview.SourceRowCount = lots.Count;
            if (lots.Count == 0)
            {
                preview.BlockingErrors.Add(
                    "No stock rows were found. Check the mapping points at the right sheet and start row.");
                return preview;
            }

            var rows = GroupLots(lots);
            await ClassifyAsync(rows, preview);
            await FlagAlreadyImportedAsync(rows, companyId, preview);

            preview.Rows = rows;
            preview.TotalQuantity = rows.Sum(r => r.Quantity);
            preview.TotalValue = rows.Sum(r => r.Value);
            preview.StatusCounts = rows.GroupBy(r => r.Status)
                .ToDictionary(g => g.Key, g => g.Count());

            var blocked = rows.Count(r =>
                r.Status is OpeningStockRowStatus.HsUnknown or OpeningStockRowStatus.Error);
            if (blocked > 0)
                preview.BlockingErrors.Add(
                    $"{blocked} row(s) cannot be imported as they stand. Fix them in the sheet, or remove them, and upload again.");

            var ambiguous = rows.Count(r => r.Status == OpeningStockRowStatus.Ambiguous);
            if (ambiguous > 0)
                preview.Warnings.Add(
                    $"{ambiguous} item(s) match an existing item under a different HS code. Choose which to use before importing.");

            if (lots.Count != rows.Count)
                preview.Warnings.Add(
                    $"{lots.Count} sheet rows became {rows.Count} items — some items are held across more than one lot and their quantities have been added together.");

            // Reported, not blocking: the operator may be re-importing on
            // purpose after setting the earlier run aside.
            var blocking = await _imports.FindBlockingRunAsync(companyId, ImportKinds.OpeningStock, fileSha256);
            if (blocking != null)
            {
                var who = blocking.ImportedByUserName;
                var when = blocking.ImportedAt.ToString("d MMM yyyy");
                preview.BlockingErrors.Add(who == null
                    ? $"This exact file was already imported on {when}. Nothing was changed."
                    : $"This exact file was already imported on {when} by {who}. Nothing was changed.");
            }

            return preview;
        }

        // ── Reading ──────────────────────────────────────────────────────────

        private sealed record LotRow(
            int SourceRow, string ItemName, string? HsCode, bool Partial,
            string? Unit, decimal Quantity, decimal Value, string? LotRef);

        private List<LotRow> ReadLots(
            byte[] bytes, string extension, LotRowsMapping mapping, OpeningStockPreviewDto preview)
        {
            var lots = new List<LotRow>();

            using var stream = new MemoryStream(bytes, writable: false);
            using var wb = WorkbookReaderFactory.Open(stream, extension);

            var sheet = mapping.SheetSelect.ResolveOne(wb);
            if (sheet < 0)
            {
                preview.BlockingErrors.Add(
                    "The sheet this layout expects was not found in the file. Check the mapping, or pick a different layout.");
                return lots;
            }

            var lastRow = wb.GetLastRow(sheet);
            var cols = mapping.Columns;
            var blankStreak = 0;

            for (int row = mapping.FirstDataRow; row <= lastRow && lots.Count < MaxSourceRows; row++)
            {
                var name = wb.GetString(sheet, row, cols.ItemName).Trim();
                var qty = cols.BalanceQty > 0 ? wb.GetDecimal(sheet, row, cols.BalanceQty) : null;

                if (string.IsNullOrWhiteSpace(name) && qty is null or 0m)
                {
                    // A formatted-but-empty tail is normal. Stop once enough
                    // consecutive blanks say the data has genuinely ended.
                    if (++blankStreak >= mapping.BlankRowsEndData) break;
                    continue;
                }
                blankStreak = 0;

                if (string.IsNullOrWhiteSpace(name)) continue;

                var full = cols.HsCodeFull is > 0
                    ? CleanHsCode(wb.GetString(sheet, row, cols.HsCodeFull.Value), mapping.HsCodeStripSuffix)
                    : null;
                var shortCode = cols.HsCodeShort is > 0
                    ? CleanHsCode(wb.GetString(sheet, row, cols.HsCodeShort.Value), mapping.HsCodeStripSuffix)
                    : null;

                // The full PCT code is what FBR accepts; a 4-digit heading is a
                // fallback that has to be flagged, because PRAL rejects it on a
                // sale (error 0052).
                var hs = !string.IsNullOrWhiteSpace(full) ? full : shortCode;
                var partial = string.IsNullOrWhiteSpace(full) && !string.IsNullOrWhiteSpace(shortCode);

                lots.Add(new LotRow(
                    SourceRow: row,
                    ItemName: name,
                    HsCode: string.IsNullOrWhiteSpace(hs) ? null : hs,
                    Partial: partial,
                    Unit: cols.Unit is > 0 ? wb.GetString(sheet, row, cols.Unit.Value).Trim() : null,
                    Quantity: qty ?? 0m,
                    Value: cols.BalanceValue is > 0 ? wb.GetDecimal(sheet, row, cols.BalanceValue.Value) ?? 0m : 0m,
                    LotRef: cols.LotRef is > 0 ? wb.GetString(sheet, row, cols.LotRef.Value).Trim() : null));
            }

            if (lots.Count >= MaxSourceRows)
                preview.Warnings.Add(
                    $"Only the first {MaxSourceRows} rows were read. If the sheet is genuinely longer, split it.");

            return lots;
        }

        /// <summary>
        /// Strips the decoration real sheets carry around a tariff code — a
        /// configured suffix, then any character that is not a digit or dot.
        /// A code that keeps it can never match the master.
        /// </summary>
        private static string? CleanHsCode(string? raw, string? stripSuffix)
        {
            if (string.IsNullOrWhiteSpace(raw)) return null;
            var value = raw.Trim();

            if (!string.IsNullOrEmpty(stripSuffix) && value.EndsWith(stripSuffix, StringComparison.Ordinal))
                value = value[..^stripSuffix.Length];

            value = new string(value.Where(c => char.IsDigit(c) || c == '.').ToArray()).Trim('.');
            return value.Length == 0 ? null : value;
        }

        /// <summary>
        /// One item held across several customs lots is ONE item type whose
        /// quantities add up. Grouping on the upper-cased name plus code matches
        /// how SQL Server compares them, so the grouping here and the catalog's
        /// unique index agree.
        /// </summary>
        private static List<OpeningStockRowDto> GroupLots(List<LotRow> lots)
        {
            return lots
                .GroupBy(l => (Name: l.ItemName.Trim().ToUpperInvariant(), Code: l.HsCode ?? ""))
                .Select(g =>
                {
                    var first = g.First();
                    var refs = g.Select(x => x.LotRef)
                        .Where(r => !string.IsNullOrWhiteSpace(r))
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .ToList();

                    return new OpeningStockRowDto
                    {
                        SourceRows = g.Select(x => x.SourceRow).OrderBy(x => x).ToList(),
                        // Keep the operator's own spelling from the first row,
                        // not the upper-cased grouping key.
                        ItemName = first.ItemName.Trim(),
                        HsCode = first.HsCode,
                        IsHsCodePartial = g.All(x => x.Partial),
                        Unit = g.Select(x => x.Unit).FirstOrDefault(u => !string.IsNullOrWhiteSpace(u)),
                        Quantity = g.Sum(x => x.Quantity),
                        Value = g.Sum(x => x.Value),
                        LotRefs = refs.Count == 0 ? null : string.Join(", ", refs),
                    };
                })
                .OrderBy(r => r.ItemName, StringComparer.OrdinalIgnoreCase)
                .ToList();
        }

        // ── Classification ───────────────────────────────────────────────────

        /// <summary>
        /// Runs the match ladder over every row. Reuse always beats create — the
        /// operator's instruction is that an item already in the catalog has its
        /// stock updated, not a duplicate made beside it.
        /// </summary>
        private async Task ClassifyAsync(List<OpeningStockRowDto> rows, OpeningStockPreviewDto preview)
        {
            var names = rows.Select(r => r.ItemName).ToList();
            var codes = rows.Where(r => r.HsCode != null).Select(r => r.HsCode!).Distinct().ToList();

            // Case-insensitive by SQL Server's default collation, which is the
            // same comparison the catalog's unique index makes.
            var catalog = await _db.ItemTypes.AsNoTracking()
                .Where(t => !t.IsDeleted && (names.Contains(t.Name) || (t.HSCode != null && codes.Contains(t.HSCode))))
                .Select(t => new { t.Id, t.Name, t.HSCode, t.IsAutoGenerated })
                .ToListAsync();

            // Master-first HS validation (CLAUDE.md 5b-2): once the tariff
            // master holds rows, a code missing from it is wrong. While it is
            // empty the check cannot be made at all, so it is skipped rather
            // than failing every row.
            var masterLoaded = await _db.HsCodes.AsNoTracking().AnyAsync();
            var knownCodes = masterLoaded && codes.Count > 0
                ? (await _db.HsCodes.AsNoTracking()
                        .Where(h => codes.Contains(h.Code))
                        .Select(h => h.Code)
                        .ToListAsync())
                    .ToHashSet(StringComparer.OrdinalIgnoreCase)
                : new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            if (!masterLoaded)
                preview.Warnings.Add(
                    "The HS code master is empty, so codes could not be checked. Run the HS Code import on the Item Types page first if you want them validated.");

            foreach (var row in rows)
            {
                if (row.Quantity <= 0m)
                {
                    row.Status = OpeningStockRowStatus.Error;
                    row.Messages.Add("No closing quantity — nothing to open with.");
                    continue;
                }

                if (row.HsCode == null)
                {
                    row.Status = OpeningStockRowStatus.Error;
                    row.Messages.Add("No HS code.");
                    continue;
                }

                if (masterLoaded && !knownCodes.Contains(row.HsCode))
                {
                    row.Status = OpeningStockRowStatus.HsUnknown;
                    row.Messages.Add($"HS code {row.HsCode} is not in the tariff master.");
                    continue;
                }

                var byName = catalog
                    .Where(t => string.Equals(t.Name.Trim(), row.ItemName, StringComparison.OrdinalIgnoreCase))
                    .ToList();

                // 1 — exact name + code.
                var exact = byName.FirstOrDefault(t =>
                    string.Equals(t.HSCode, row.HsCode, StringComparison.OrdinalIgnoreCase));
                if (exact != null)
                {
                    row.Status = OpeningStockRowStatus.Matched;
                    row.ItemTypeId = exact.Id;
                    row.MatchedName = exact.Name;
                    continue;
                }

                // 2 — an auto-generated placeholder already owns this code.
                var placeholder = catalog.FirstOrDefault(t =>
                    t.IsAutoGenerated && string.Equals(t.HSCode, row.HsCode, StringComparison.OrdinalIgnoreCase));
                if (placeholder != null)
                {
                    row.Status = OpeningStockRowStatus.MatchedRenamed;
                    row.ItemTypeId = placeholder.Id;
                    row.MatchedName = placeholder.Name;
                    row.Messages.Add($"Reuses the placeholder for {row.HsCode}, renaming it to \"{row.ItemName}\".");
                    continue;
                }

                // 3 — the name exists but was never classified.
                var unclassified = byName.FirstOrDefault(t => string.IsNullOrWhiteSpace(t.HSCode));
                if (unclassified != null)
                {
                    row.Status = OpeningStockRowStatus.MatchedClassified;
                    row.ItemTypeId = unclassified.Id;
                    row.MatchedName = unclassified.Name;
                    row.Messages.Add($"Existing item has no HS code; {row.HsCode} will be filled in.");
                    continue;
                }

                // 4 — same name, different code. Only a human can say whether
                // that is the same product reclassified or a different one.
                if (byName.Count > 0)
                {
                    row.Status = OpeningStockRowStatus.Ambiguous;
                    row.Candidates = byName.Select(t => new OpeningStockCandidateDto
                    {
                        ItemTypeId = t.Id,
                        Name = t.Name,
                        HsCode = t.HSCode,
                        IsAutoGenerated = t.IsAutoGenerated,
                    }).ToList();
                    row.Messages.Add(
                        $"\"{row.ItemName}\" already exists under HS code {byName[0].HSCode ?? "(none)"}. Reuse it, or create a separate item.");
                    continue;
                }

                row.Status = OpeningStockRowStatus.WillCreate;
                if (row.IsHsCodePartial)
                    row.Messages.Add("Only a 4-digit heading was available — this item cannot be billed to FBR until a full code is set.");
            }
        }

        /// <summary>
        /// The content-level duplicate check, which the file hash cannot make.
        /// A workbook re-saved or re-exported has different bytes but identical
        /// data, and importing it again is pointless at best.
        ///
        /// For opening stock "already imported" means the item already carries
        /// an opening balance of exactly this quantity in this company. A file
        /// where every row is like that is refused; one with some new rows is
        /// not, because that is a sheet that has genuinely grown — the normal
        /// way these workbooks arrive a second time.
        /// </summary>
        private async Task FlagAlreadyImportedAsync(
            List<OpeningStockRowDto> rows, int companyId, OpeningStockPreviewDto preview)
        {
            var importable = rows
                .Where(r => r.Status is not OpeningStockRowStatus.Error and not OpeningStockRowStatus.HsUnknown)
                .ToList();
            if (importable.Count == 0) return;

            var matchedIds = importable
                .Where(r => r.ItemTypeId.HasValue)
                .Select(r => r.ItemTypeId!.Value)
                .Distinct()
                .ToList();
            if (matchedIds.Count == 0) return;

            var existing = await _db.OpeningStockBalances.AsNoTracking()
                .Where(o => o.CompanyId == companyId && matchedIds.Contains(o.ItemTypeId))
                .Select(o => new { o.ItemTypeId, o.Quantity })
                .ToListAsync();

            if (existing.Count == 0) return;

            var byItem = existing.ToDictionary(e => e.ItemTypeId, e => e.Quantity);

            var unchanged = importable.Count(r =>
                r.ItemTypeId.HasValue
                && byItem.TryGetValue(r.ItemTypeId.Value, out var qty)
                && qty == r.Quantity);

            if (unchanged == 0) return;

            if (unchanged == importable.Count)
            {
                preview.BlockingErrors.Add(
                    "Every row in this file has already been imported — each item already carries exactly this opening quantity. Nothing would change.");
                return;
            }

            preview.Warnings.Add(
                $"{unchanged} of {importable.Count} items already carry exactly this opening quantity and will be rewritten unchanged; {importable.Count - unchanged} differ.");
        }

        // ── Commit ───────────────────────────────────────────────────────────

        public async Task<OpeningStockCommitResultDto> CommitAsync(OpeningStockCommitDto dto, int userId)
        {
            var result = new OpeningStockCommitResultDto();

            // Defence in depth. The filtered unique index on ImportRun is the
            // real guarantee, but failing here gives a message the operator can
            // read instead of a constraint violation.
            var blocking = await _imports.FindBlockingRunAsync(
                dto.CompanyId, ImportKinds.OpeningStock, dto.FileSha256);
            if (blocking != null)
                throw new InvalidOperationException(
                    $"This exact file was already imported on {blocking.ImportedAt:d MMM yyyy}. Nothing was changed.");

            var rows = dto.Rows
                .Where(r => !string.IsNullOrWhiteSpace(r.ItemName) && r.Quantity > 0m)
                .ToList();
            if (rows.Count == 0)
                throw new InvalidOperationException("There is nothing to import.");

            await using var tx = await _db.Database.BeginTransactionAsync();
            try
            {
                // Keep the free-text catalogs in step with what the import
                // introduces, so the bill form offers these names and the Units
                // screen can set decimal policy on these UOMs. Both are
                // case-insensitively idempotent and never throw.
                await UnitRegistry.EnsureNamesAsync(_db, rows.Select(r => r.Unit));
                await ItemDescriptionRegistry.EnsureNamesAsync(_db, rows.Select(r => r.ItemName));

                var hsIds = await ResolveHsCodeIdsAsync(rows);

                foreach (var row in rows)
                {
                    var itemTypeId = row.ItemTypeId.HasValue
                        ? await UpdateItemTypeAsync(row, hsIds, result)
                        : await CreateItemTypeAsync(row, hsIds, result);

                    await UpsertOpeningBalanceAsync(dto, row, itemTypeId);
                    result.OpeningBalancesWritten++;
                    result.TotalQuantity += row.Quantity;
                }

                if (dto.EnableInventoryTracking)
                    result.InventoryTrackingEnabled = await EnableTrackingAsync(dto.CompanyId, result);

                if (dto.PostInventoryValue)
                    result.InventoryValuePosted = await PostInventoryValueAsync(
                        dto.CompanyId, rows.Sum(r => r.Value), result);

                var run = new ImportRun
                {
                    CompanyId = dto.CompanyId,
                    Kind = ImportKinds.OpeningStock,
                    ImportProfileId = dto.ImportProfileId,
                    ProfileVersion = dto.ProfileVersion,
                    FileSha256 = (dto.FileSha256 ?? "").Trim().ToLowerInvariant(),
                    OriginalFileName = Trim(dto.FileName, 400),
                    FileSizeBytes = dto.FileSizeBytes,
                    CountsJson = JsonSerializer.Serialize(new Dictionary<string, int>
                    {
                        ["itemTypesCreated"] = result.ItemTypesCreated,
                        ["itemTypesUpdated"] = result.ItemTypesUpdated,
                        ["openingBalances"] = result.OpeningBalancesWritten,
                    }),
                    ImportedByUserId = userId,
                    ImportedAt = DateTime.UtcNow,
                };
                _db.ImportRuns.Add(run);
                await _db.SaveChangesAsync();

                await tx.CommitAsync();
                result.ImportRunId = run.Id;

                _logger.LogInformation(
                    "Opening stock import into company {CompanyId}: {Created} created, {Updated} updated, {Balances} opening balances",
                    dto.CompanyId, result.ItemTypesCreated, result.ItemTypesUpdated, result.OpeningBalancesWritten);

                return result;
            }
            catch
            {
                // A half-imported stock sheet is worse than none — the operator
                // cannot tell which items landed without checking every one.
                await tx.RollbackAsync();
                throw;
            }
        }

        private async Task<Dictionary<string, int>> ResolveHsCodeIdsAsync(List<OpeningStockCommitRowDto> rows)
        {
            var codes = rows.Where(r => !string.IsNullOrWhiteSpace(r.HsCode))
                .Select(r => r.HsCode!).Distinct().ToList();
            if (codes.Count == 0) return new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

            var found = await _db.HsCodes.AsNoTracking()
                .Where(h => codes.Contains(h.Code))
                .Select(h => new { h.Id, h.Code })
                .ToListAsync();

            var map = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            foreach (var h in found) map[h.Code] = h.Id;
            return map;
        }

        private async Task<int> UpdateItemTypeAsync(
            OpeningStockCommitRowDto row, Dictionary<string, int> hsIds, OpeningStockCommitResultDto result)
        {
            var item = await _db.ItemTypes.FirstOrDefaultAsync(t => t.Id == row.ItemTypeId!.Value)
                ?? throw new InvalidOperationException(
                    $"The item chosen for \"{row.ItemName}\" no longer exists. Preview the file again.");

            var changed = false;

            // Renaming a placeholder is the point of reusing it. The
            // IsAutoGenerated flag deliberately stays set — the HS association
            // is what it records, not the name.
            if (!string.Equals(item.Name.Trim(), row.ItemName.Trim(), StringComparison.Ordinal)
                && item.IsAutoGenerated)
            {
                item.Name = row.ItemName.Trim();
                changed = true;
            }

            if (string.IsNullOrWhiteSpace(item.HSCode) && !string.IsNullOrWhiteSpace(row.HsCode))
            {
                item.HSCode = row.HsCode;
                item.IsHsCodePartial = row.IsHsCodePartial;
                changed = true;
            }

            if (item.HsCodeId == null && row.HsCode != null && hsIds.TryGetValue(row.HsCode, out var hsId))
            {
                item.HsCodeId = hsId;
                changed = true;
            }

            if (string.IsNullOrWhiteSpace(item.UOM) && !string.IsNullOrWhiteSpace(row.Unit))
            {
                item.UOM = row.Unit!.Trim();
                changed = true;
            }

            // An item now carrying real stock belongs in the curated pickers.
            if (!item.IsFavorite) { item.IsFavorite = true; changed = true; }

            if (changed) result.ItemTypesUpdated++;
            return item.Id;
        }

        private async Task<int> CreateItemTypeAsync(
            OpeningStockCommitRowDto row, Dictionary<string, int> hsIds, OpeningStockCommitResultDto result)
        {
            var name = row.ItemName.Trim();

            // The catalog's unique index on (Name, HSCode) is case-insensitive
            // and pad-insensitive. Re-checking it here — rather than trusting
            // the preview — keeps a stale preview from turning into a duplicate
            // key that would be misread as some other collision entirely.
            var existing = await _db.ItemTypes
                .FirstOrDefaultAsync(t => !t.IsDeleted && t.Name == name && t.HSCode == row.HsCode);
            if (existing != null)
                return await UpdateItemTypeAsync(
                    new OpeningStockCommitRowDto
                    {
                        ItemName = row.ItemName, HsCode = row.HsCode,
                        IsHsCodePartial = row.IsHsCodePartial, Unit = row.Unit,
                        ItemTypeId = existing.Id,
                    }, hsIds, result);

            var item = new ItemType
            {
                Name = name,
                HSCode = row.HsCode,
                IsHsCodePartial = row.IsHsCodePartial,
                UOM = string.IsNullOrWhiteSpace(row.Unit) ? null : row.Unit!.Trim(),
                HsCodeId = row.HsCode != null && hsIds.TryGetValue(row.HsCode, out var hsId) ? hsId : null,
                IsFavorite = true,
                IsAutoGenerated = false,
                CreatedAt = DateTime.UtcNow,
            };

            _db.ItemTypes.Add(item);
            await _db.SaveChangesAsync();

            result.ItemTypesCreated++;
            return item.Id;
        }

        private async Task UpsertOpeningBalanceAsync(
            OpeningStockCommitDto dto, OpeningStockCommitRowDto row, int itemTypeId)
        {
            var note = string.IsNullOrWhiteSpace(row.LotRefs)
                ? "Imported from stock sheet"
                : $"Imported from stock sheet — lots {row.LotRefs}";

            var existing = await _db.OpeningStockBalances
                .FirstOrDefaultAsync(o => o.CompanyId == dto.CompanyId && o.ItemTypeId == itemTypeId);

            if (existing == null)
            {
                _db.OpeningStockBalances.Add(new OpeningStockBalance
                {
                    CompanyId = dto.CompanyId,
                    ItemTypeId = itemTypeId,
                    Quantity = row.Quantity,
                    AsOfDate = dto.AsOfDate.Date,
                    Notes = Trim(note, 500),
                    CreatedAt = DateTime.UtcNow,
                });
            }
            else
            {
                // Set, not add. Re-importing a corrected sheet has to REPLACE
                // the opening figure; accumulating would silently double it.
                existing.Quantity = row.Quantity;
                existing.AsOfDate = dto.AsOfDate.Date;
                existing.Notes = Trim(note, 500);
            }

            await _db.SaveChangesAsync();
        }

        private async Task<bool> EnableTrackingAsync(int companyId, OpeningStockCommitResultDto result)
        {
            var company = await _db.Companies.FirstOrDefaultAsync(c => c.Id == companyId);
            if (company == null) return false;

            if (!company.InventoryTrackingEnabled)
            {
                company.InventoryTrackingEnabled = true;
                result.Messages.Add("Inventory tracking switched on for this company.");
            }

            if (company.InventoryFlowVersion < 2)
            {
                company.InventoryFlowVersion = 2;
                // V2 defaults the guard on — over-committing stock starts
                // returning 409. That outlives the import, so say it plainly.
                company.StockGuardHardBlock = true;
                result.Messages.Add(
                    "Every item type is now tracked as inventory, and selling more than is on hand is blocked.");
            }

            await _db.SaveChangesAsync();
            return true;
        }

        /// <summary>
        /// Puts the sheet's total value on the Inventory control account as an
        /// opening balance. The contra side goes to Retained earnings inside
        /// <see cref="IAccountService.AdjustOpeningBalanceAsync"/>, so no
        /// balancing entry is made — or wanted — here.
        /// </summary>
        private async Task<decimal> PostInventoryValueAsync(
            int companyId, decimal total, OpeningStockCommitResultDto result)
        {
            if (total <= 0m) return 0m;

            var inventory = await _db.Accounts.AsNoTracking()
                .Where(a => a.CompanyId == companyId && a.ControlType == ControlType.Inventory && a.IsActive)
                .OrderBy(a => a.Id)
                .Select(a => new { a.Id, a.Name })
                .FirstOrDefaultAsync();

            if (inventory == null)
            {
                result.Messages.Add(
                    "No Inventory account was found, so the stock value was not posted. Seed the chart of accounts, then set it by hand.");
                return 0m;
            }

            await _accounts.AdjustOpeningBalanceAsync(inventory.Id, new AdjustOpeningBalanceDto
            {
                OpeningBalance = total,
                OpeningBalanceIsDebit = true,
            });

            result.Messages.Add($"{total:N2} posted as the opening balance on {inventory.Name}.");
            return total;
        }

        private static string Trim(string? value, int max)
        {
            var v = (value ?? "").Trim();
            return v.Length <= max ? v : v[..max];
        }
    }
}
