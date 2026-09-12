using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
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
        /// matching.
        ///
        /// <paramref name="tracking"/> is false for <see cref="PreviewAsync"/>
        /// (read-only) and true for <see cref="CommitAsync"/>, which mutates
        /// <c>OpeningStockBalance.ActualCostExcludingTax</c> on these exact
        /// tracked instances — and, just as importantly, re-runs <see cref="Match"/>
        /// against this SAME fresh, company-scoped index rather than trusting a
        /// client-claimed <c>OpeningStockBalanceId</c> on its own.
        /// </summary>
        private async Task<MatchIndex> BuildMatchIndexAsync(int companyId, bool tracking = false)
        {
            IQueryable<OpeningStockBalance> query = _db.OpeningStockBalances
                .Include(b => b.ItemType)
                .Include(b => b.Lots)
                .Where(b => b.CompanyId == companyId);
            if (!tracking) query = query.AsNoTracking();

            var balances = await query.ToListAsync();

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
        /// Candidate balance ids for one GD number + HS code: (a) an exact hit
        /// against the company's own lots; (b) otherwise, every balance whose
        /// item type's HS code cleans to the same code. (b) only runs when (a)
        /// found nothing — evaluated per LINE rather than per company, which
        /// gives the same answer as a per-company branch for every company seen
        /// so far (AY/PAK match entirely through (a), Alpha entirely through
        /// (b) since it has no lots at all) while also being correct for a
        /// company with a genuine mix of the two.
        ///
        /// Takes the two raw fields rather than a <see cref="GdCostingSheetRow"/>
        /// so <see cref="CommitAsync"/> can call the exact same resolution
        /// against a reviewed <see cref="GdCostingLineDto"/>'s own GdNumber/HsCode
        /// — re-deriving the match from server truth instead of trusting the
        /// line's claimed <c>OpeningStockBalanceId</c>.
        /// </summary>
        private static List<int> Match(string? gdNumber, string? hsCode, MatchIndex index)
        {
            var hsKey = GdCostingMapping.CleanHsCode(hsCode);
            if (hsKey.Length == 0) return new List<int>();

            var gdKey = NormalizeGd(gdNumber);

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
            var matches = rows.Select(r => Match(r.GdNumber, r.HsCode, index)).ToList();
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
                // Server truth, never the client's claim: a fresh, company-
                // scoped, TRACKED match index. A line claiming CostOnly is
                // re-matched below from its OWN GdNumber/HsCode against this —
                // the same resolution preview used — rather than merely
                // checking that the claimed OpeningStockBalanceId happens to
                // belong to this company. "Belongs to this company" is not
                // "is the match this line's own GD/HS would produce"; trusting
                // the former let a forged line write a real cost onto an
                // unrelated item under any HS code in the company. Tracked, so
                // the same instances this verifies against are the ones the
                // derived-cost step below mutates.
                var index = await BuildMatchIndexAsync(dto.CompanyId, tracking: true);

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
                // Lines Task 15's opt-in flag resolved as genuinely new stock
                // — grouped and turned into ItemType + OpeningStockBalance
                // rows in the post-pass below (CreateMissingStockAsync), once
                // every line's own entity (and therefore its recomputed
                // Cost/SellingValue) has been built.
                var newStockLines = new List<(ImportConsignmentLine Entity, NewStockGroupKey Key, GdCostingLineDto Line)>();

                foreach (var line in lines)
                {
                    var consignment = consignmentsByGd[line.GdNumber.Trim()];
                    var disposition = GdCostingDispositionNames.Parse(line.Disposition);
                    string? dispositionNote = null;
                    int? balanceIdToWrite = null;
                    NewStockGroupKey? newStockKey = null;

                    if (disposition == GdCostingDisposition.StockPosted)
                    {
                        if (!dto.CreateMissingStock)
                        {
                            // Default (opted-out) behaviour: unchanged,
                            // byte-for-byte, from before Task 15. Told, not
                            // silently dropped.
                            disposition = GdCostingDisposition.Skipped;
                            dispositionNote = "Posting new stock arrives in a later release.";
                        }
                        else
                        {
                            // Opted in (Task 15). Never trust "this is new
                            // stock" from the client either — re-run the same
                            // server-truth Match() a CostOnly claim already
                            // gets (Task 10 fix round 1). Only a line the
                            // server's OWN index finds NOTHING for may create
                            // anything; anything else is resolved exactly as
                            // a forged CostOnly claim already is, whatever
                            // the client's disposition said.
                            var freshCandidates = Match(line.GdNumber, line.HsCode, index);
                            if (freshCandidates.Count == 0)
                            {
                                // Genuinely new stock. Disposition stays
                                // StockPosted; the item type and opening
                                // balance are resolved in the post-pass below
                                // — a group sharing one (HsCode, Name) target
                                // needs every member's own recomputed figures
                                // before it can total them.
                                newStockKey = new NewStockGroupKey(
                                    GdCostingMapping.CleanHsCode(line.HsCode),
                                    NormalizeItemName(line.Description));
                            }
                            else if (freshCandidates.Count > 1)
                            {
                                disposition = GdCostingDisposition.Ambiguous;
                                var names = freshCandidates
                                    .Select(id => index.Balances.TryGetValue(id, out var b) ? (b.ItemType?.Name ?? $"item #{id}") : $"item #{id}")
                                    .Distinct(StringComparer.OrdinalIgnoreCase)
                                    .OrderBy(n => n, StringComparer.OrdinalIgnoreCase)
                                    .ToList();
                                dispositionNote = $"Matches more than one opening balance under HS code {line.HsCode}: {string.Join(", ", names)}. No cost was written — resolve manually.";
                            }
                            else
                            {
                                // The server's own match disagrees with the
                                // client's "unmatched" claim — this is a
                                // CostOnly line, not a new one, whatever the
                                // client said.
                                disposition = GdCostingDisposition.CostOnly;
                                balanceIdToWrite = freshCandidates[0];
                            }
                        }
                    }
                    else if (disposition == GdCostingDisposition.CostOnly)
                    {
                        // Never trust the claimed OpeningStockBalanceId on its
                        // own — re-run the SAME match this line's own
                        // GdNumber/HsCode would produce against the fresh,
                        // company-scoped index, and require the claim to be
                        // the SOLE result. Anything else is a claim that does
                        // not hold up against this company's own records —
                        // whether that is a stale preview, an edited request,
                        // a deleted balance, or a line pointed at an unrelated
                        // item under a different HS code entirely.
                        var candidates = Match(line.GdNumber, line.HsCode, index);

                        if (candidates.Count == 1 && line.OpeningStockBalanceId == candidates[0])
                        {
                            balanceIdToWrite = candidates[0];
                        }
                        else if (candidates.Count > 1)
                        {
                            disposition = GdCostingDisposition.Ambiguous;
                            var names = candidates
                                .Select(id => index.Balances.TryGetValue(id, out var b) ? (b.ItemType?.Name ?? $"item #{id}") : $"item #{id}")
                                .Distinct(StringComparer.OrdinalIgnoreCase)
                                .OrderBy(n => n, StringComparer.OrdinalIgnoreCase)
                                .ToList();
                            dispositionNote = $"Matches more than one opening balance under HS code {line.HsCode}: {string.Join(", ", names)}. No cost was written — resolve manually.";
                        }
                        else
                        {
                            disposition = GdCostingDisposition.Skipped;
                            dispositionNote = "The claimed opening balance does not match this line's own GD number and HS code, re-checked against this company's own records. Nothing was written for this line.";
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

                    // Server truth for the money, too: recompute from this
                    // line's OWN raw inputs via the same calculator preview
                    // used, rather than trusting the echoed Cost/SalesTax/
                    // Ast/IncomeTax/SellingValue. A mismatch does not fail the
                    // line — the recomputed figures are used and it is noted,
                    // never silently accepted either way.
                    var computed = ImportCostingCalculator.Compute(new ImportCostingCalculator.ImportCostingInput(
                        AssessedValue: line.AssessedValue,
                        CustomsDuty: line.CustomsDuty,
                        Acd: line.Acd,
                        RegulatoryDuty: line.RegulatoryDuty,
                        Others: line.Others,
                        SalesTaxRate: line.SalesTaxRate,
                        AstRate: line.AstRate,
                        IncomeTaxRate: line.IncomeTaxRate,
                        AddOnProfit: line.AddOnProfit));

                    if (Math.Abs(computed.Cost - line.Cost) > 0.01m
                        || Math.Abs(computed.SellingValue - line.SellingValue) > 0.01m)
                    {
                        const string mismatch = "The submitted cost figures did not match this line's own raw inputs; the recomputed figures were used instead.";
                        dispositionNote = string.IsNullOrEmpty(dispositionNote) ? mismatch : $"{dispositionNote} {mismatch}";
                    }

                    // A genuine sheet-stated selling-value override is
                    // legitimate data an operator typed by hand (nine of
                    // PAK's 83 lines rely on one) — kept as-is rather than
                    // "corrected" by the recompute, which only touches the
                    // DERIVED figures.
                    var sellingValue = line.SheetSellingValue.HasValue
                        ? Money(line.SheetSellingValue.Value)
                        : Money(computed.SellingValue);

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
                        CostExcludingTax = Money(computed.Cost),
                        SellingValueExcludingTax = sellingValue,
                        Disposition = disposition,
                        DispositionNote = Trim(dispositionNote, 500) is { Length: > 0 } dn ? dn : null,
                        // Only a VERIFIED match earns an ItemTypeId — this
                        // reads the server's own re-resolution above, never
                        // the client's claim.
                        ItemTypeId = balanceIdToWrite.HasValue ? index.Balances[balanceIdToWrite.Value].ItemTypeId : null,
                        OpeningStockBalanceId = balanceIdToWrite,
                        CreatedAt = DateTime.UtcNow,
                    };
                    _db.ImportConsignmentLines.Add(entity);
                    writtenLines.Add(entity);

                    if (disposition == GdCostingDisposition.CostOnly && balanceIdToWrite.HasValue)
                        costedBalanceIds.Add(balanceIdToWrite.Value);

                    if (newStockKey.HasValue)
                        newStockLines.Add((entity, newStockKey.Value, line));
                }

                // The unit cost is derived here from the WRITTEN entities' own
                // (server-recomputed, verified) Cost/Quantity — never from the
                // client's claimed DerivedActualCost, and never from the
                // client's raw Cost either, now that each line's CostExcludingTax
                // above is itself the recomputed figure. It is an AGGREGATE over
                // however many lines matched one balance; trusting a per-line
                // copy of a shared figure invites a "last line wins" bug the
                // moment two lines disagree. Same formula as preview, applied to
                // exactly the lines that verified as cost-only for this balance.
                foreach (var balanceId in costedBalanceIds)
                {
                    var balance = index.Balances[balanceId];
                    var matching = writtenLines.Where(e =>
                        e.Disposition == GdCostingDisposition.CostOnly && e.OpeningStockBalanceId == balanceId).ToList();

                    var totalCost = matching.Sum(e => e.CostExcludingTax);
                    var totalQty = matching.Sum(e => e.Quantity);
                    var unitCost = totalQty != 0m ? totalCost / totalQty : 0m;
                    balance.ActualCostExcludingTax = Math.Round(unitCost * balance.Quantity, 2, MidpointRounding.AwayFromZero);
                }

                // Task 15, opt-in only: lines the server independently proved
                // touch nothing on the books become new stock here — never
                // inline in the loop above, because a group sharing one
                // (HsCode, Name) target needs every member's own recomputed
                // Cost/SellingValue collected first.
                var (itemTypesCreated, itemTypesAdopted, openingBalancesCreated) =
                    await CreateMissingStockAsync(dto.CompanyId, newStockLines);

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
                        ["itemTypesCreated"] = itemTypesCreated,
                        ["itemTypesAdopted"] = itemTypesAdopted,
                        ["openingBalancesCreated"] = openingBalancesCreated,
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
                // Includes StockPosted now too — that disposition only ever
                // reaches a written line when Task 15's flag actually created
                // stock from it, so its cost was just as much "written" as a
                // CostOnly line's. Under the default (flag off) behaviour no
                // line can carry StockPosted here, so this is unchanged then.
                result.TotalCostExcludingTax = Money(
                    writtenLines.Where(l => l.Disposition == GdCostingDisposition.CostOnly
                                          || l.Disposition == GdCostingDisposition.StockPosted)
                        .Sum(l => l.CostExcludingTax));
                result.ItemTypesCreated = itemTypesCreated;
                result.ItemTypesAdopted = itemTypesAdopted;
                result.OpeningBalancesCreated = openingBalancesCreated;

                if (result.BalancesCosted > 0)
                    result.Messages.Add($"{result.BalancesCosted} opening balance(s) received an actual cost.");
                var deferred = writtenLines.Count(l =>
                    l.Disposition == GdCostingDisposition.Skipped
                    && l.DispositionNote == "Posting new stock arrives in a later release.");
                if (deferred > 0)
                    result.Messages.Add($"{deferred} line(s) had no match on the books and were skipped — posting new stock arrives in a later release.");
                if (openingBalancesCreated > 0 || itemTypesCreated > 0 || itemTypesAdopted > 0)
                    result.Messages.Add(
                        $"{openingBalancesCreated} opening balance(s) created for unmatched lines ({itemTypesCreated} new item type(s) created, {itemTypesAdopted} adopted from the HS code master).");
                if (result.LinesAmbiguous > 0)
                    result.Messages.Add($"{result.LinesAmbiguous} line(s) matched more than one opening balance and were left unresolved.");

                _logger.LogInformation(
                    "GD costing import into company {CompanyId}: {Consignments} consignments, {Lines} lines, {Costed} balances costed, {ItemTypesCreated} item types created, {BalancesCreated} balances created",
                    dto.CompanyId, result.ConsignmentsWritten, result.LinesWritten, result.BalancesCosted,
                    itemTypesCreated, openingBalancesCreated);

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

        // ── New stock (Task 15, opt-in) ─────────────────────────────────────

        /// <summary>
        /// Case- and trim-insensitive key for grouping lines that would
        /// create or reuse the SAME item type. Both fields are normalised
        /// before construction (not compared with a custom comparer at use
        /// time) so the record's own default equality — which is ordinal —
        /// is already the right comparison, mirroring the CI+ANSI-PadSpace
        /// collation the (Name, HSCode) unique index itself compares under.
        /// An ordinal check against UN-normalised values here is exactly the
        /// anti-pattern CLAUDE.md calls out elsewhere: a name the index would
        /// treat as a duplicate ("X" vs "X " vs "x") read as three different
        /// groups.
        /// </summary>
        private readonly record struct NewStockGroupKey(string HsCode, string NormalizedName);

        private static string NormalizeItemName(string? name) => (name ?? "").Trim().ToUpperInvariant();

        /// <summary>
        /// Turns lines re-verified above as touching nothing on the books
        /// into new stock: one ItemType (reused, adopted, or created — see
        /// below) and one OpeningStockBalance per distinct (HS code, name)
        /// target, grouping lines that share a target exactly as the
        /// CostOnly aggregation in <see cref="CommitAsync"/> groups lines
        /// that share a balance. Runs inside the caller's own transaction —
        /// nothing here opens or commits one.
        ///
        /// No StockMovement, no GL entry, no Company.GlLockDate: this is an
        /// OPENING position, not a live movement (brief part B) — the same
        /// boundary <see cref="IGdCostingImportService"/>'s own doc comment
        /// already draws around the CostOnly path.
        /// </summary>
        private async Task<(int Created, int Adopted, int BalancesCreated)> CreateMissingStockAsync(
            int companyId,
            List<(ImportConsignmentLine Entity, NewStockGroupKey Key, GdCostingLineDto Line)> newStockLines)
        {
            if (newStockLines.Count == 0) return (0, 0, 0);

            var itemTypesCreated = 0;
            var itemTypesAdopted = 0;
            var openingBalancesCreated = 0;

            var groups = newStockLines.GroupBy(t => t.Key).ToList();

            // Resolved per group: the ItemType to use (existing, adopted, or
            // brand new) and its members. ItemTypes are created and flushed
            // FIRST, in their own SaveChanges round, because
            // OpeningStockBalance.ItemTypeId needs a REAL id — like every FK
            // on ImportConsignmentLine itself, there is no navigation
            // property here for EF to fix up automatically (see that
            // entity's own doc comment for why ItemTypeId/OpeningStockBalanceId
            // stay plain columns).
            var resolved = new List<(ItemType ItemType, List<(ImportConsignmentLine Entity, GdCostingLineDto Line)> Members)>();

            // One DB round trip per distinct HS code in this batch, not per
            // group — several groups can legitimately share an HS code under
            // different product names (CLAUDE.md 5b-3: one tariff line can
            // carry several products).
            var candidatesByHs = new Dictionary<string, List<ItemType>>();

            foreach (var g in groups)
            {
                var key = g.Key;
                var members = g.Select(t => (t.Entity, t.Line)).ToList();

                if (key.NormalizedName.Length == 0)
                {
                    // No description on the sheet to name a new item after —
                    // never invent one. Skipped with a reason instead of a
                    // silent, nameless ItemType (the same "resolves to
                    // NOTHING rather than a guess" rule advance/further tax
                    // already follow — CLAUDE.md 5b-5/5b-10).
                    const string reason = "This line has no description, so a new item type could not be named. Nothing was created.";
                    foreach (var (entity, _) in members)
                    {
                        entity.Disposition = GdCostingDisposition.Skipped;
                        entity.ItemTypeId = null;
                        entity.OpeningStockBalanceId = null;
                        entity.DispositionNote = Trim(
                            string.IsNullOrEmpty(entity.DispositionNote) ? reason : $"{entity.DispositionNote} {reason}", 500);
                    }
                    continue;
                }

                if (!candidatesByHs.TryGetValue(key.HsCode, out var hsCandidates))
                {
                    // NULL and "" are not the same key on the (Name, HSCode)
                    // unique index (SQL Server treats NULL as equal-to-NULL
                    // for uniqueness, so two un-coded items with the same
                    // name WOULD collide) — an empty cleaned code must look
                    // up NULL-coded rows, not skip the lookup.
                    hsCandidates = key.HsCode.Length == 0
                        ? await _db.ItemTypes.Where(it => !it.IsDeleted && it.HSCode == null).ToListAsync()
                        : await _db.ItemTypes.Where(it => !it.IsDeleted && it.HSCode == key.HsCode).ToListAsync();
                    candidatesByHs[key.HsCode] = hsCandidates;
                }

                // HS code AND name must both match to reuse a row — the same
                // HS code legitimately carries several distinct products
                // (CLAUDE.md 5b-3: "3923.2900" already named "PVC CARD COVER"
                // is not "EMPTY PLASTIC DISTRIBUTION BOX" under the same
                // code, just because the code matches).
                var existing = hsCandidates.FirstOrDefault(it => NormalizeItemName(it.Name) == key.NormalizedName);

                ItemType itemType;
                if (existing != null)
                {
                    itemType = existing;
                    // Adoption signal per CLAUDE.md 5b-2 is IsFavorite, never
                    // IsAutoGenerated (which is never cleared). Never rename
                    // a global placeholder — ItemType has no CompanyId, so a
                    // rename would be visible to every tenant, not just this
                    // company.
                    if (existing.IsAutoGenerated && !existing.IsFavorite)
                    {
                        existing.IsFavorite = true;
                        itemTypesAdopted++;
                    }
                }
                else
                {
                    var name = Trim(members[0].Line.Description, 300);
                    var unit = string.IsNullOrWhiteSpace(members[0].Line.Unit) ? null : Trim(members[0].Line.Unit, 50);
                    itemType = new ItemType
                    {
                        Name = name,
                        HSCode = key.HsCode.Length > 0 ? key.HsCode : null,
                        UOM = unit,
                        IsAutoGenerated = false,
                        IsFavorite = true,
                    };
                    _db.ItemTypes.Add(itemType);
                    itemTypesCreated++;

                    // Keep the free-text lookups every other typed-name save
                    // path feeds in sync (challan create/edit/import, bill
                    // update, item-type save) — both helpers are idempotent
                    // and race-safe, and route the collation-sensitive
                    // matching through the one place CLAUDE.md's anti-
                    // patterns list already calls out for this exact trap.
                    await ItemDescriptionRegistry.EnsureNamesAsync(_db, new[] { name });
                    if (unit != null) await UnitRegistry.EnsureNamesAsync(_db, new[] { unit });
                }

                resolved.Add((itemType, members));
            }

            if (resolved.Count == 0) return (itemTypesCreated, itemTypesAdopted, 0);

            // Flush new ItemTypes (and the IsFavorite adoption flips) so
            // every group below has a real ItemTypeId to point
            // OpeningStockBalance/ImportConsignmentLine at.
            await _db.SaveChangesAsync();

            foreach (var (itemType, members) in resolved)
            {
                // Register this company against the catalog row, mirroring
                // ItemTypeService's own EnsureRegisteredAsync (private there,
                // so reproduced here rather than shared). Belt-and-braces:
                // the OpeningStockBalance created just below already puts
                // this item type in ItemTypeRepository.CompanyItemTypeIds's
                // "openings" leg, so visibility does not actually depend on
                // this row — but every other path that gives a company a new
                // item type writes one regardless (CLAUDE.md 5b-2b), and a
                // registration that outlives one opening balance (should it
                // ever be edited away) is more robust than relying solely on
                // derived membership.
                await EnsureItemTypeRegisteredAsync(companyId, itemType.Id);

                var totalQty = members.Sum(m => m.Entity.Quantity);
                var totalCost = Money(members.Sum(m => m.Entity.CostExcludingTax));
                var totalValue = Money(members.Sum(m => m.Entity.SellingValueExcludingTax));
                // Quantity-weighted so one dominant line sets the rate when a
                // target is fed by more than one line — the common case is
                // exactly one line, which this reduces to that line's own
                // rate untouched.
                var rate = totalQty != 0m
                    ? Math.Round(members.Sum(m => m.Entity.Quantity * m.Line.SalesTaxRate) / totalQty, 2, MidpointRounding.AwayFromZero)
                    : Math.Round(members[0].Line.SalesTaxRate, 2, MidpointRounding.AwayFromZero);
                var asOfDate = members
                    .Select(m => m.Line.GdDate)
                    .Where(d => d.HasValue)
                    .Select(d => d!.Value)
                    .DefaultIfEmpty(DateTime.UtcNow.Date)
                    .Min();
                var gdNumbers = members
                    .Select(m => m.Line.GdNumber.Trim())
                    .Where(n => n.Length > 0)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .OrderBy(n => n, StringComparer.OrdinalIgnoreCase)
                    .ToList();
                var originNote = Trim($"Opening stock created from GD costing import: GD {string.Join(", ", gdNumbers)}.", 500);

                var balance = await _db.OpeningStockBalances
                    .FirstOrDefaultAsync(b => b.CompanyId == companyId && b.ItemTypeId == itemType.Id);
                if (balance == null)
                {
                    balance = new OpeningStockBalance
                    {
                        CompanyId = companyId,
                        ItemTypeId = itemType.Id,
                        Quantity = totalQty,
                        ValueExcludingTax = totalValue,
                        ActualCostExcludingTax = totalCost,
                        SalesTaxRate = rate,
                        AsOfDate = asOfDate,
                        Notes = originNote,
                        CreatedAt = DateTime.UtcNow,
                    };
                    _db.OpeningStockBalances.Add(balance);
                    openingBalancesCreated++;
                }
                else
                {
                    // Defensive only — brief part B/D's "if one somehow
                    // exists". Match() already proved this company had no
                    // balance under this HS code, so this should not be
                    // reachable in practice. Additive, never overwritten: an
                    // operator's existing figures are never silently
                    // replaced by this import (the same "never remove a
                    // balance it did not touch" caution CLAUDE.md 5b-3
                    // applies to a spreadsheet re-import).
                    balance.Quantity += totalQty;
                    balance.ValueExcludingTax = Money(balance.ValueExcludingTax + totalValue);
                    balance.ActualCostExcludingTax = Money(balance.ActualCostExcludingTax + totalCost);
                    balance.Notes = Trim($"{balance.Notes} | {originNote}".Trim(' ', '|'), 500);
                }

                await _db.SaveChangesAsync();

                var successNote = members.Count > 1
                    ? $"New item type and opening stock balance created from this line, combined with {members.Count - 1} other line(s) under the same item."
                    : "New item type and opening stock balance created from this line.";
                foreach (var (entity, _) in members)
                {
                    entity.ItemTypeId = itemType.Id;
                    entity.OpeningStockBalanceId = balance.Id;
                    entity.DispositionNote = Trim(
                        string.IsNullOrEmpty(entity.DispositionNote) ? successNote : $"{entity.DispositionNote} {successNote}", 500);
                }
            }

            return (itemTypesCreated, itemTypesAdopted, openingBalancesCreated);
        }

        /// <summary>
        /// Records that <paramref name="companyId"/> has this catalog row on
        /// its books. Same idempotent shape as the private
        /// <c>ItemTypeService.EnsureRegisteredAsync</c> — reproduced here
        /// rather than shared, since that method is private to its own
        /// service. Does not call SaveChanges itself; the caller's own next
        /// round trip flushes it.
        /// </summary>
        private async Task EnsureItemTypeRegisteredAsync(int companyId, int itemTypeId)
        {
            var exists = await _db.CompanyItemTypeSettings
                .AnyAsync(s => s.CompanyId == companyId && s.ItemTypeId == itemTypeId);
            if (exists) return;
            _db.CompanyItemTypeSettings.Add(new CompanyItemTypeSetting
            {
                CompanyId = companyId,
                ItemTypeId = itemTypeId,
                UpdatedAt = DateTime.UtcNow,
            });
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
