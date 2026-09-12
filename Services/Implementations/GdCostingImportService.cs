using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers.ExcelImport;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <inheritdoc cref="IGdCostingImportService"/>
    public class GdCostingImportService : IGdCostingImportService
    {
        private readonly AppDbContext _db;
        private readonly ISpreadsheetImportService _imports;
        private readonly ILogger<GdCostingImportService> _logger;

        /// <summary>A costing sheet with more lines than this is not a costing
        /// sheet. Keeps a malformed mapping from walking an entire workbook —
        /// mirrors <c>OpeningStockImportService.MaxSourceRows</c>.</summary>
        public const int MaxSourceRows = 5000;

        public GdCostingImportService(
            AppDbContext db,
            ISpreadsheetImportService imports,
            ILogger<GdCostingImportService> logger)
        {
            _db = db;
            _imports = imports;
            _logger = logger;
        }

        // ── Preview ──────────────────────────────────────────────────────────

        public async Task<GdCostingPreviewDto> PreviewAsync(
            byte[] bytes, string extension, string fileName, string fileSha256,
            string mappingJson, int companyId, int? profileId, int? profileVersion)
        {
            var mapping = GdCostingMapping.Parse(mappingJson);

            var preview = new GdCostingPreviewDto
            {
                FileName = fileName,
                FileSha256 = fileSha256,
                FileSizeBytes = bytes.LongLength,
                ImportProfileId = profileId,
                ProfileVersion = profileVersion,
            };

            GdCostingSheetResult sheetResult;
            using (var stream = new MemoryStream(bytes, writable: false))
            using (var wb = WorkbookReaderFactory.Open(stream, extension))
            {
                // The built-in layout ships with no sheetSelect criteria (there
                // is nothing to disambiguate — unlike the stock sheet's many
                // tabs or the ledger's index-plus-per-customer sheets, a GD
                // costing workbook is one dedicated sheet per file, exactly as
                // scripts/gd_costing_harness assumes by always reading sheet 0).
                // ResolveOne("byHeaderText" with no mustContain) always answers
                // -1 in that case, so fall back to the first sheet rather than
                // blocking on a criterion nothing was ever meant to supply. An
                // operator-saved layout that DOES set real criteria is honoured
                // as given.
                var sheet = mapping.SheetSelect.ResolveOne(wb);
                if (sheet < 0) sheet = 0;

                sheetResult = GdCostingSheetReader.Read(wb, sheet, mapping);
            }

            preview.Warnings.AddRange(sheetResult.Warnings);
            preview.SourceRowCount = sheetResult.Rows.Count;

            if (sheetResult.Rows.Count == 0)
            {
                preview.BlockingErrors.Add(
                    "No consignment lines were found. Check the mapping points at the right sheet and start row.");
                return preview;
            }

            if (sheetResult.Rows.Count > MaxSourceRows)
            {
                preview.BlockingErrors.Add(
                    $"This sheet has more than {MaxSourceRows} lines, which is not a GD costing sheet. Check the mapping, or split the file.");
                return preview;
            }

            var index = await BuildMatchIndexAsync(companyId);
            var outcomes = MatchAll(sheetResult.Rows, index);

            preview.Lines = sheetResult.Rows
                .Select((row, i) => ToLineDto(row, outcomes[i]))
                .ToList();
            preview.Consignments = BuildConsignmentTotals(preview.Lines);
            preview.DispositionCounts = preview.Lines
                .GroupBy(l => l.Disposition)
                .ToDictionary(g => g.Key, g => g.Count());

            // A GD this company already has a consignment for has no upsert
            // path in this release (CLAUDE.md-style: create, not update) — say
            // so before commit hits the unique index and surfaces as a raw 500.
            var gdNumbers = preview.Lines.Select(l => l.GdNumber).ToList();
            var existingGds = await FindExistingGdNumbersAsync(companyId, gdNumbers);
            if (existingGds.Count > 0)
                preview.BlockingErrors.Add(
                    $"GD {string.Join(", ", existingGds)} already {(existingGds.Count == 1 ? "has" : "have")} a consignment recorded for this company. Re-importing a GD costing sheet is not supported yet.");

            var blocking = await _imports.FindBlockingRunAsync(companyId, ImportKinds.GdCosting, fileSha256);
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

        // ── Matching, in memory (CLAUDE.md: match per LINE, in C#, not SQL) ──

        private sealed record MatchIndex(
            Dictionary<(string Gd, string Hs), List<int>> ByLot,
            Dictionary<string, List<int>> ByHsCode,
            Dictionary<int, OpeningStockBalance> Balances);

        /// <summary>
        /// Loads the company's opening stock balances (with their item type)
        /// and lots ONCE — small across every real installation (174 balances,
        /// 237 lots across all three companies) — and indexes them for in-memory
        /// matching. Read-only: <see cref="CommitAsync"/> re-queries the
        /// specific balances it will mutate, tracked, rather than reusing this.
        /// </summary>
        private async Task<MatchIndex> BuildMatchIndexAsync(int companyId)
        {
            var balances = await _db.OpeningStockBalances
                .AsNoTracking()
                .Include(b => b.ItemType)
                .Include(b => b.Lots)
                .Where(b => b.CompanyId == companyId)
                .ToListAsync();

            var byLot = new Dictionary<(string, string), List<int>>();
            var byHsCode = new Dictionary<string, List<int>>();
            var byId = new Dictionary<int, OpeningStockBalance>();

            foreach (var b in balances)
            {
                byId[b.Id] = b;

                foreach (var lot in b.Lots)
                {
                    var gdKey = NormalizeGd(lot.LotRef);
                    var hsKey = GdCostingMapping.CleanHsCode(lot.HsCode);
                    if (gdKey.Length == 0 || hsKey.Length == 0) continue;

                    var key = (gdKey, hsKey);
                    if (!byLot.TryGetValue(key, out var list)) byLot[key] = list = new List<int>();
                    if (!list.Contains(b.Id)) list.Add(b.Id);
                }

                var itemHs = GdCostingMapping.CleanHsCode(b.ItemType?.HSCode);
                if (itemHs.Length > 0)
                {
                    if (!byHsCode.TryGetValue(itemHs, out var list2)) byHsCode[itemHs] = list2 = new List<int>();
                    if (!list2.Contains(b.Id)) list2.Add(b.Id);
                }
            }

            return new MatchIndex(byLot, byHsCode, byId);
        }

        /// <summary>
        /// Candidate balance ids for one line: (a) an exact GD number + cleaned
        /// HS code hit against the company's own lots; (b) otherwise, every
        /// balance whose item type's HS code cleans to the same code. (b) only
        /// runs when (a) found nothing — evaluated per LINE rather than per
        /// company, which gives the same answer as a per-company branch for
        /// every company seen so far (AY/PAK match entirely through (a), Alpha
        /// entirely through (b) since it has no lots at all) while also being
        /// correct for a company with a genuine mix of the two.
        /// </summary>
        private static List<int> Match(GdCostingSheetRow row, MatchIndex index)
        {
            var hsKey = GdCostingMapping.CleanHsCode(row.HsCode);
            if (hsKey.Length == 0) return new List<int>();

            var gdKey = NormalizeGd(row.GdNumber);

            if (index.ByLot.TryGetValue((gdKey, hsKey), out var lotHit) && lotHit.Count > 0)
                return lotHit;

            if (index.ByHsCode.TryGetValue(hsKey, out var hsHit) && hsHit.Count > 0)
                return hsHit;

            return new List<int>();
        }

        private sealed record LineOutcome(
            string Disposition, int? OpeningStockBalanceId, int? ItemTypeId, string? ItemTypeName,
            decimal MatchedBalanceQuantity, decimal DerivedActualCost, string? MatchNote);

        /// <summary>
        /// Resolves every line's disposition. A balance matched by exactly one
        /// line's worth of candidates is grouped with every OTHER line in the
        /// sheet (any GD) that resolves to the same balance, because the unit
        /// cost the brief specifies —
        /// <c>unitCost = SUM(line.Cost) / SUM(line.Quantity)</c> — is meant to
        /// be trustworthy across the whole sheet, not one GD at a time.
        /// </summary>
        private static LineOutcome[] MatchAll(List<GdCostingSheetRow> rows, MatchIndex index)
        {
            var matches = rows.Select(r => Match(r, index)).ToList();
            var outcomes = new LineOutcome?[rows.Count];

            var byBalance = new Dictionary<int, List<int>>();
            for (int i = 0; i < rows.Count; i++)
            {
                if (matches[i].Count != 1) continue;
                var balanceId = matches[i][0];
                if (!byBalance.TryGetValue(balanceId, out var list)) byBalance[balanceId] = list = new List<int>();
                list.Add(i);
            }

            foreach (var (balanceId, rowIdxs) in byBalance)
            {
                var balance = index.Balances[balanceId];
                var totalCost = rowIdxs.Sum(i => rows[i].Computed.Cost);
                var totalQty = rowIdxs.Sum(i => rows[i].Quantity);
                // The unit cost is the trustworthy figure from the GD; the
                // quantity is the trustworthy figure from the books (brief,
                // Task 10 step 2). A balance quantity of zero derives zero
                // through the multiplication below without any special case.
                var unitCost = totalQty != 0m ? totalCost / totalQty : 0m;
                var derivedCost = Math.Round(unitCost * balance.Quantity, 2, MidpointRounding.AwayFromZero);

                string? note = null;
                if (Math.Abs(totalQty - balance.Quantity) > 0.0001m)
                    note = $"This GD covers {FormatQty(totalQty)} of the {FormatQty(balance.Quantity)} on the books; its unit cost was applied to the whole balance.";

                var outcome = new LineOutcome(
                    GdCostingDispositionNames.CostOnly, balance.Id, balance.ItemTypeId, balance.ItemType?.Name,
                    balance.Quantity, derivedCost, note);

                foreach (var i in rowIdxs) outcomes[i] = outcome;
            }

            for (int i = 0; i < rows.Count; i++)
            {
                if (outcomes[i] != null) continue;

                var row = rows[i];
                var hsKey = GdCostingMapping.CleanHsCode(row.HsCode);

                if (matches[i].Count > 1)
                {
                    var names = matches[i]
                        .Select(id => index.Balances[id].ItemType?.Name ?? $"item #{id}")
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .OrderBy(n => n, StringComparer.OrdinalIgnoreCase)
                        .ToList();

                    // A guess here writes a wrong cost onto the wrong item —
                    // exactly the failure mode this feature exists to prevent
                    // (brief, Task 10 step 1) — so no OpeningStockBalanceId is
                    // set, ever, on an ambiguous line.
                    outcomes[i] = new LineOutcome(
                        GdCostingDispositionNames.Ambiguous, null, null, null, 0m, 0m,
                        $"Matches more than one opening balance under HS code {(hsKey.Length > 0 ? hsKey : row.HsCode)}: {string.Join(", ", names)}. No cost was written — resolve manually.");
                }
                else
                {
                    var note = hsKey.Length == 0
                        ? "This line has no HS code, so it cannot be matched to existing stock."
                        : $"No opening balance was found under HS code {hsKey}. This looks like new stock, not yet on the books.";

                    outcomes[i] = new LineOutcome(
                        GdCostingDispositionNames.StockPosted, null, null, null, 0m, 0m, note);
                }
            }

            return outcomes.Select(o => o!).ToArray();
        }

        private static string NormalizeGd(string? gd) => (gd ?? "").Trim().ToUpperInvariant();

        private static string FormatQty(decimal q) =>
            q == Math.Truncate(q) ? q.ToString("N0") : q.ToString("N2");

        private static GdCostingLineDto ToLineDto(GdCostingSheetRow row, LineOutcome outcome) => new()
        {
            SourceRow = row.SourceRow,
            GdNumber = row.GdNumber,
            GdDate = row.GdDate,
            Description = row.Description,
            HsCode = row.HsCode,
            Quantity = row.Quantity,
            Unit = row.Unit,

            AssessedValue = row.Input.AssessedValue,
            CustomsDuty = row.Input.CustomsDuty,
            Acd = row.Input.Acd,
            RegulatoryDuty = row.Input.RegulatoryDuty,
            Others = row.Input.Others,
            SalesTaxRate = row.Input.SalesTaxRate,
            AstRate = row.Input.AstRate,
            IncomeTaxRate = row.Input.IncomeTaxRate,
            AddOnProfit = row.Input.AddOnProfit,

            Cost = row.Computed.Cost,
            SalesTax = row.Computed.SalesTax,
            Ast = row.Computed.Ast,
            Subtotal = row.Computed.Subtotal,
            IncomeTax = row.Computed.IncomeTax,
            InputTax = row.Computed.InputTax,
            SellingValue = row.Computed.SellingValue,
            SheetSellingValue = row.SheetSellingValue,

            Disposition = outcome.Disposition,
            OpeningStockBalanceId = outcome.OpeningStockBalanceId,
            ItemTypeId = outcome.ItemTypeId,
            ItemTypeName = outcome.ItemTypeName,
            MatchedBalanceQuantity = outcome.MatchedBalanceQuantity,
            DerivedActualCost = outcome.DerivedActualCost,
            MatchNote = outcome.MatchNote,
        };

        private static List<GdCostingConsignmentTotalsDto> BuildConsignmentTotals(List<GdCostingLineDto> lines) =>
            lines.GroupBy(l => l.GdNumber.Trim(), StringComparer.OrdinalIgnoreCase)
                .Select(g => new GdCostingConsignmentTotalsDto
                {
                    GdNumber = g.First().GdNumber.Trim(),
                    GdDate = g.Select(l => l.GdDate).FirstOrDefault(d => d.HasValue),
                    LineCount = g.Count(),
                    TotalCostExcludingTax = Money(g.Sum(l => l.Cost)),
                    TotalSalesTax = Money(g.Sum(l => l.SalesTax)),
                    TotalAst = Money(g.Sum(l => l.Ast)),
                    TotalIncomeTax = Money(g.Sum(l => l.IncomeTax)),
                    TotalInputTax = Money(g.Sum(l => l.InputTax)),
                    TotalSellingValue = Money(g.Sum(l => l.SellingValue)),
                })
                .OrderBy(c => c.GdNumber, StringComparer.OrdinalIgnoreCase)
                .ToList();

        private async Task<List<string>> FindExistingGdNumbersAsync(int companyId, IEnumerable<string> gdNumbers)
        {
            var wanted = gdNumbers
                .Select(g => (g ?? "").Trim())
                .Where(g => g.Length > 0)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            if (wanted.Count == 0) return new List<string>();

            return await _db.ImportConsignments.AsNoTracking()
                .Where(c => c.CompanyId == companyId && wanted.Contains(c.GdNumber))
                .Select(c => c.GdNumber)
                .ToListAsync();
        }

        // ── Commit ───────────────────────────────────────────────────────────

        public async Task<GdCostingCommitResultDto> CommitAsync(GdCostingCommitDto dto, int userId)
        {
            var result = new GdCostingCommitResultDto();

            // Defence in depth — the filtered unique index on ImportRun is the
            // real guarantee, but failing here gives a message the operator can
            // read instead of a constraint violation.
            var blocking = await _imports.FindBlockingRunAsync(
                dto.CompanyId, ImportKinds.GdCosting, dto.FileSha256);
            if (blocking != null)
                throw new InvalidOperationException(
                    $"This exact file was already imported on {blocking.ImportedAt:d MMM yyyy}. Nothing was changed.");

            var lines = (dto.Lines ?? new List<GdCostingLineDto>())
                .Where(l => !string.IsNullOrWhiteSpace(l.GdNumber))
                .ToList();
            if (lines.Count == 0)
                throw new InvalidOperationException("There is nothing to import.");
            if (lines.Count > MaxSourceRows)
                throw new InvalidOperationException("Too many rows in one import. Split the file and try again.");

            var gdNumbers = lines.Select(l => l.GdNumber).ToList();
            var existingGds = await FindExistingGdNumbersAsync(dto.CompanyId, gdNumbers);
            if (existingGds.Count > 0)
                throw new InvalidOperationException(
                    $"GD {string.Join(", ", existingGds)} already {(existingGds.Count == 1 ? "has" : "have")} a consignment recorded for this company. Nothing was changed.");

            await using var tx = await _db.Database.BeginTransactionAsync();
            try
            {
                // Tenant safety: a line claiming CostOnly carries an
                // OpeningStockBalanceId from the reviewed preview, but a body
                // field is never trusted on its own (CLAUDE.md: never trust
                // dto.CompanyId — the same applies to any id a body carries).
                // Only balances genuinely owned by THIS company can be costed.
                var claimedBalanceIds = lines
                    .Where(l => string.Equals(l.Disposition, GdCostingDispositionNames.CostOnly, StringComparison.OrdinalIgnoreCase)
                                && l.OpeningStockBalanceId.HasValue)
                    .Select(l => l.OpeningStockBalanceId!.Value)
                    .Distinct()
                    .ToList();

                var balanceMap = claimedBalanceIds.Count == 0
                    ? new Dictionary<int, OpeningStockBalance>()
                    : (await _db.OpeningStockBalances
                            .Where(b => b.CompanyId == dto.CompanyId && claimedBalanceIds.Contains(b.Id))
                            .ToListAsync())
                        .ToDictionary(b => b.Id);

                // One ImportConsignment per GD, grouping on the same
                // case/whitespace-insensitive key the matcher used, so a sheet
                // that repeats "kapw-1" and "KAPW-1" across rows is one
                // consignment, not two colliding on the unique index.
                var consignmentsByGd = new Dictionary<string, ImportConsignment>(StringComparer.OrdinalIgnoreCase);
                foreach (var group in lines.GroupBy(l => l.GdNumber.Trim(), StringComparer.OrdinalIgnoreCase))
                {
                    var gdDate = group.Select(l => l.GdDate).FirstOrDefault(d => d.HasValue);
                    var consignment = new ImportConsignment
                    {
                        CompanyId = dto.CompanyId,
                        GdNumber = Trim(group.First().GdNumber, 64),
                        GdDate = gdDate ?? DateTime.UtcNow.Date,
                        TotalCostExcludingTax = Money(group.Sum(l => l.Cost)),
                        TotalInputTax = Money(group.Sum(l => l.InputTax)),
                        TotalIncomeTax = Money(group.Sum(l => l.IncomeTax)),
                        TotalSellingValue = Money(group.Sum(l => l.SellingValue)),
                        Notes = gdDate.HasValue
                            ? null
                            : "Declaration date was not on the sheet for this GD; the import date was used instead.",
                        CreatedAt = DateTime.UtcNow,
                    };
                    _db.ImportConsignments.Add(consignment);
                    consignmentsByGd[group.Key] = consignment;
                }

                // Consignments need their ids before the lines below can point
                // at them.
                await _db.SaveChangesAsync();

                var writtenLines = new List<ImportConsignmentLine>();
                var costedBalanceIds = new HashSet<int>();

                foreach (var line in lines)
                {
                    var consignment = consignmentsByGd[line.GdNumber.Trim()];
                    var disposition = GdCostingDispositionNames.Parse(line.Disposition);
                    string? dispositionNote = null;
                    int? balanceIdToWrite = null;

                    if (disposition == GdCostingDisposition.StockPosted)
                    {
                        // Round 1 scope limit: no stock movement, no GL entry.
                        // Told, not silently dropped.
                        disposition = GdCostingDisposition.Skipped;
                        dispositionNote = "Posting new stock arrives in a later release.";
                    }
                    else if (disposition == GdCostingDisposition.CostOnly)
                    {
                        if (line.OpeningStockBalanceId is int claimedId && balanceMap.ContainsKey(claimedId))
                        {
                            balanceIdToWrite = claimedId;
                        }
                        else
                        {
                            // A stale preview, a tampered request, or a balance
                            // deleted since preview all land here — recorded,
                            // never trusted blind.
                            disposition = GdCostingDisposition.Skipped;
                            dispositionNote = "The matched opening balance could not be verified for this company. Nothing was written for this line.";
                        }
                    }
                    else if (disposition == GdCostingDisposition.Ambiguous)
                    {
                        var trimmedNote = Trim(line.MatchNote, 500);
                        dispositionNote = trimmedNote.Length > 0
                            ? trimmedNote
                            : "Matches more than one opening balance. No cost was written.";
                    }
                    else
                    {
                        var trimmedNote = Trim(line.MatchNote, 500);
                        dispositionNote = trimmedNote.Length > 0 ? trimmedNote : null;
                    }

                    var entity = new ImportConsignmentLine
                    {
                        ImportConsignmentId = consignment.Id,
                        SourceRow = line.SourceRow,
                        DescriptionOnSheet = Trim(line.Description, 300),
                        HsCode = string.IsNullOrWhiteSpace(line.HsCode) ? null : Trim(line.HsCode, 20),
                        Quantity = line.Quantity,
                        Unit = string.IsNullOrWhiteSpace(line.Unit) ? null : Trim(line.Unit, 50),
                        // Money fields go through the same 2dp rounding as
                        // everywhere else in this codebase, rather than
                        // leaning on SQL Server to truncate a sheet cell's
                        // extra decimal places silently at insert time.
                        AssessedValue = Money(line.AssessedValue),
                        CustomsDuty = Money(line.CustomsDuty),
                        Acd = Money(line.Acd),
                        RegulatoryDuty = Money(line.RegulatoryDuty),
                        Others = Money(line.Others),
                        SalesTaxRate = line.SalesTaxRate,
                        AstRate = line.AstRate,
                        IncomeTaxRate = line.IncomeTaxRate,
                        AddOnProfit = Money(line.AddOnProfit),
                        CostExcludingTax = Money(line.Cost),
                        SellingValueExcludingTax = Money(line.SellingValue),
                        Disposition = disposition,
                        DispositionNote = dispositionNote,
                        // Only a VERIFIED match earns an ItemTypeId — the
                        // balance map above already checked tenancy, so this
                        // reads the server's own resolution, not the client's.
                        ItemTypeId = balanceIdToWrite.HasValue ? balanceMap[balanceIdToWrite.Value].ItemTypeId : null,
                        OpeningStockBalanceId = balanceIdToWrite,
                        CreatedAt = DateTime.UtcNow,
                    };
                    _db.ImportConsignmentLines.Add(entity);
                    writtenLines.Add(entity);

                    if (disposition == GdCostingDisposition.CostOnly && balanceIdToWrite.HasValue)
                        costedBalanceIds.Add(balanceIdToWrite.Value);
                }

                // The unit cost is recomputed here from the reviewed lines'
                // own Cost/Quantity — not trusted from the client's
                // DerivedActualCost — because it is an AGGREGATE over however
                // many lines matched one balance; trusting a per-line copy of
                // a shared figure invites a "last line wins" bug the moment two
                // lines disagree. Same formula as preview, applied to exactly
                // the lines the operator approved as cost-only for this balance.
                foreach (var balanceId in costedBalanceIds)
                {
                    var balance = balanceMap[balanceId];
                    var matching = lines.Where(l =>
                        string.Equals(l.Disposition, GdCostingDispositionNames.CostOnly, StringComparison.OrdinalIgnoreCase)
                        && l.OpeningStockBalanceId == balanceId).ToList();

                    var totalCost = matching.Sum(l => l.Cost);
                    var totalQty = matching.Sum(l => l.Quantity);
                    var unitCost = totalQty != 0m ? totalCost / totalQty : 0m;
                    balance.ActualCostExcludingTax = Math.Round(unitCost * balance.Quantity, 2, MidpointRounding.AwayFromZero);
                }

                var run = new ImportRun
                {
                    CompanyId = dto.CompanyId,
                    Kind = ImportKinds.GdCosting,
                    ImportProfileId = dto.ImportProfileId,
                    ProfileVersion = dto.ProfileVersion,
                    FileSha256 = (dto.FileSha256 ?? "").Trim().ToLowerInvariant(),
                    OriginalFileName = Trim(dto.FileName, 400),
                    FileSizeBytes = dto.FileSizeBytes,
                    CountsJson = JsonSerializer.Serialize(new Dictionary<string, int>
                    {
                        ["consignments"] = consignmentsByGd.Count,
                        ["lines"] = writtenLines.Count,
                        ["balancesCosted"] = costedBalanceIds.Count,
                    }),
                    ImportedByUserId = userId,
                    ImportedAt = DateTime.UtcNow,
                };
                _db.ImportRuns.Add(run);
                await _db.SaveChangesAsync();

                // Stamped after the run exists, inside the same transaction, so
                // a line or consignment never carries a null pointing at
                // nothing (brief, Task 10 step 4).
                foreach (var line in writtenLines) line.ImportRunId = run.Id;
                foreach (var consignment in consignmentsByGd.Values) consignment.ImportRunId = run.Id;
                await _db.SaveChangesAsync();

                await tx.CommitAsync();

                result.ImportRunId = run.Id;
                result.ConsignmentsWritten = consignmentsByGd.Count;
                result.LinesWritten = writtenLines.Count;
                result.BalancesCosted = costedBalanceIds.Count;
                result.LinesSkipped = writtenLines.Count(l => l.Disposition == GdCostingDisposition.Skipped);
                result.LinesAmbiguous = writtenLines.Count(l => l.Disposition == GdCostingDisposition.Ambiguous);
                result.TotalCostExcludingTax = Money(
                    writtenLines.Where(l => l.Disposition == GdCostingDisposition.CostOnly).Sum(l => l.CostExcludingTax));

                if (result.BalancesCosted > 0)
                    result.Messages.Add($"{result.BalancesCosted} opening balance(s) received an actual cost.");
                var deferred = writtenLines.Count(l =>
                    l.Disposition == GdCostingDisposition.Skipped
                    && l.DispositionNote == "Posting new stock arrives in a later release.");
                if (deferred > 0)
                    result.Messages.Add($"{deferred} line(s) had no match on the books and were skipped — posting new stock arrives in a later release.");
                if (result.LinesAmbiguous > 0)
                    result.Messages.Add($"{result.LinesAmbiguous} line(s) matched more than one opening balance and were left unresolved.");

                _logger.LogInformation(
                    "GD costing import into company {CompanyId}: {Consignments} consignments, {Lines} lines, {Costed} balances costed",
                    dto.CompanyId, result.ConsignmentsWritten, result.LinesWritten, result.BalancesCosted);

                return result;
            }
            catch
            {
                // A half-imported consignment set is worse than none — roll
                // back everything rather than leave some lines written and
                // others not.
                await tx.RollbackAsync();
                throw;
            }
        }

        private static decimal Money(decimal value) =>
            Math.Round(value, 2, MidpointRounding.AwayFromZero);

        private static string Trim(string? value, int max)
        {
            var v = (value ?? "").Trim();
            return v.Length <= max ? v : v[..max];
        }
    }
}
