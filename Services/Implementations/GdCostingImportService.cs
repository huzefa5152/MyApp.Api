using System.Globalization;
using System.Security.Cryptography;
using System.Text;
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
    /// <inheritdoc cref="IGdCostingImportService"/>
    public class GdCostingImportService : IGdCostingImportService
    {
        private readonly AppDbContext _db;
        private readonly IAccountService _accounts;
        private readonly ISpreadsheetImportService _imports;
        private readonly IPostingService _posting;
        private readonly IStockCostAuditService _costAudit;
        private readonly ILogger<GdCostingImportService> _logger;

        /// <summary>A costing sheet with more lines than this is not a costing
        /// sheet. Keeps a malformed mapping from walking an entire workbook —
        /// mirrors <c>OpeningStockImportService.MaxSourceRows</c>.</summary>
        public const int MaxSourceRows = 5000;

        public GdCostingImportService(
            AppDbContext db,
            IAccountService accounts,
            ISpreadsheetImportService imports,
            IPostingService posting,
            IStockCostAuditService costAudit,
            ILogger<GdCostingImportService> logger)
        {
            _db = db;
            _accounts = accounts;
            _imports = imports;
            _posting = posting;
            _costAudit = costAudit;
            _logger = logger;
        }

        // ── Preview ──────────────────────────────────────────────────────────

        public async Task<GdCostingPreviewDto> PreviewAsync(
            byte[] bytes, string extension, string fileName, string fileSha256,
            string mappingJson, int companyId, int? profileId, int? profileVersion, string? mode)
        {
            var mapping = GdCostingMapping.Parse(mappingJson);

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

            return await BuildPreviewAsync(
                sheetResult.Rows, sheetResult.Warnings, fileName, fileSha256, bytes.LongLength,
                companyId, profileId, profileVersion, GdCostingImportModeNames.Normalize(mode));
        }

        /// <inheritdoc cref="IGdCostingImportService.PreviewManualAsync"/>
        ///
        /// <remarks>
        /// A manual line has no bytes to fingerprint, so <c>FileSha256</c> is a
        /// SHA-256 of the line's own content (every field the operator typed,
        /// plus the company id) rather than of uploaded bytes — see
        /// <see cref="ManualEntryFingerprint"/>. That gives a manual commit the
        /// same guarantee the file path gets for free: submitting the
        /// identical line twice collides on <c>ImportRun</c>'s own
        /// (CompanyId, Kind, FileSha256) unique index — the same "this exact
        /// file was already imported" guard a re-uploaded workbook trips —
        /// while two lines differing in any field never collide with each
        /// other. <c>FileSizeBytes</c> is the byte length of that same
        /// canonical content, so it is not an arbitrary placeholder either.
        /// </remarks>
        public async Task<GdCostingPreviewDto> PreviewManualAsync(
            IReadOnlyList<GdCostingManualLineDto> lines, int companyId, string? mode)
        {
            if (lines == null || lines.Count == 0)
                throw new InvalidOperationException("Add at least one line before previewing.");
            if (lines.Count > MaxSourceRows)
                throw new InvalidOperationException(
                    $"A hand-entered consignment cannot carry more than {MaxSourceRows} lines.");

            var warnings = new List<string>();
            var rows = new List<GdCostingSheetRow>(lines.Count);
            foreach (var line in lines)
            {
                ValidateManualLine(line);
                rows.Add(BuildManualRow(line, warnings));
            }

            // EVERY line goes through BuildPreviewAsync in ONE call, never one
            // call per line. Matching, per-balance pooling and the plausibility
            // check all reason over the SET: two lines hitting the same balance
            // must pool into a single unit cost, and previewing them separately
            // would report each as if it were alone — the very extrapolation
            // error the cost-plausibility warning exists to catch.
            var (sha256, sizeBytes) = ManualEntryFingerprint(companyId, lines);
            var gdNumbers = rows
                .Select(r => r.GdNumber.Trim())
                .Where(g => g.Length > 0)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(g => g, StringComparer.OrdinalIgnoreCase)
                .ToList();

            return await BuildPreviewAsync(
                rows, warnings,
                fileName: gdNumbers.Count == 1
                    ? $"Manual entry — GD {gdNumbers[0]}"
                    : $"Manual entry — {rows.Count} lines across GD {string.Join(", ", gdNumbers)}",
                fileSha256: sha256,
                fileSizeBytes: sizeBytes,
                companyId: companyId,
                profileId: null,
                profileVersion: null,
                mode: GdCostingImportModeNames.Normalize(mode));
        }

        /// <summary>
        /// Everything a file-sourced preview does AFTER the workbook has been
        /// turned into rows: match against opening stock, cost, group into
        /// consignments, and check both duplicate guards. The one seam
        /// <see cref="PreviewAsync"/> and <see cref="PreviewManualAsync"/>
        /// share — a hand-typed line is run through this SAME method, not a
        /// reimplementation of it, so nothing about matching or costing can
        /// drift between the two entry points.
        /// </summary>
        private async Task<GdCostingPreviewDto> BuildPreviewAsync(
            List<GdCostingSheetRow> rows, List<string> warnings,
            string fileName, string fileSha256, long fileSizeBytes,
            int companyId, int? profileId, int? profileVersion, string mode)
        {
            var preview = new GdCostingPreviewDto
            {
                FileName = fileName,
                FileSha256 = fileSha256,
                FileSizeBytes = fileSizeBytes,
                ImportProfileId = profileId,
                ProfileVersion = profileVersion,
            };

            preview.Warnings.AddRange(warnings);
            preview.SourceRowCount = rows.Count;

            if (rows.Count == 0)
            {
                preview.BlockingErrors.Add(
                    "No consignment lines were found. Check the mapping points at the right sheet and start row.");
                return preview;
            }

            if (rows.Count > MaxSourceRows)
            {
                preview.BlockingErrors.Add(
                    $"This sheet has more than {MaxSourceRows} lines, which is not a GD costing sheet. Check the mapping, or split the file.");
                return preview;
            }

            var index = await BuildMatchIndexAsync(companyId);
            var outcomes = MatchAll(rows, index, mode);

            preview.Lines = rows
                .Select((row, i) => ToLineDto(row, outcomes[i]))
                .ToList();
            preview.Consignments = BuildConsignmentTotals(preview.Lines);
            preview.DispositionCounts = preview.Lines
                .GroupBy(l => l.Disposition)
                .ToDictionary(g => g.Key, g => g.Count());
            preview.OverwriteWarningCount = preview.Lines.Count(l => l.OverwriteWarning != null);
            preview.CostPlausibilityWarningCount = preview.Lines.Count(l => l.CostPlausibilityWarning != null);
            preview.RateWarningCount = preview.Lines.Count(l => l.RateWarning != null);

            // A GD this company already has a consignment for has no upsert
            // path in this release (CLAUDE.md-style: create, not update) — say
            // so before commit hits the unique index and surfaces as a raw 500.
            var gdNumbers = preview.Lines.Select(l => l.GdNumber).ToList();
            var existingGds = await FindExistingGdNumbersAsync(companyId, gdNumbers);
            if (existingGds.Count > 0)
                preview.BlockingErrors.Add(
                    $"GD {string.Join(", ", existingGds)} already {(existingGds.Count == 1 ? "has" : "have")} a consignment recorded for this company. Open the Consignments screen and delete the existing one first if you need to re-import it.");

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

        /// <summary>
        /// Turns a hand-typed manual line into the same
        /// <see cref="GdCostingSheetRow"/> shape <see cref="GdCostingSheetReader.Read"/>
        /// produces per sheet row — same HS-code cleaning
        /// (<see cref="GdCostingMapping.CleanHsCode"/>), same costing
        /// calculator, same "no HS code" / "stated selling value differs"
        /// warnings, reworded only to say "you" rather than "the sheet" since
        /// there is no sheet. <paramref name="warnings"/> is appended to, not
        /// replaced, so the caller supplies (and keeps) the list.
        /// </summary>
        private static GdCostingSheetRow BuildManualRow(GdCostingManualLineDto line, List<string> warnings)
        {
            var gd = (line.GdNumber ?? "").Trim();
            var description = (line.Description ?? "").Trim();
            var hsCode = GdCostingMapping.CleanHsCode(line.HsCode);
            var unit = string.IsNullOrWhiteSpace(line.Unit) ? null : line.Unit.Trim();

            var input = new ImportCostingCalculator.ImportCostingInput(
                AssessedValue: line.AssessedValue,
                CustomsDuty: line.CustomsDuty,
                Acd: line.Acd,
                RegulatoryDuty: line.RegulatoryDuty,
                Others: line.Others,
                SalesTaxRate: line.SalesTaxRate,
                AstRate: line.AstRate,
                IncomeTaxRate: line.IncomeTaxRate,
                AddOnProfit: line.AddOnProfit);

            // The one place this chain is computed — same calculator, same
            // formula, as the file path (ImportCostingCalculator's own doc
            // comment carries the formula).
            var computed = ImportCostingCalculator.Compute(input);

            if (hsCode.Length == 0)
                warnings.Add($"{gd} has no HS code. The line was imported without one.");

            // Mirrors GdCostingSheetReader's own override rule: a stated
            // selling value that disagrees with the computed one by more than
            // a paisa wins, and the preview says so.
            if (line.SellingValue.HasValue
                && Math.Abs(line.SellingValue.Value - computed.SellingValue) > 0.01m)
            {
                warnings.Add(
                    $"You stated a selling value of {line.SellingValue.Value:N2} " +
                    $"where the costing gives {computed.SellingValue:N2}. Your figure was kept.");
            }

            return new GdCostingSheetRow(
                1, gd, line.GdDate, description, hsCode, line.Quantity, unit, input, computed, line.SellingValue);
        }

        /// <summary>
        /// Rejects with an operator-facing message before anything downstream
        /// sees a half-filled line — mirrors <see cref="GdCostingMapping.Parse"/>
        /// throwing for a mapping that cannot drive an import.
        /// </summary>
        private static void ValidateManualLine(GdCostingManualLineDto line)
        {
            if (line == null) throw new InvalidOperationException("Enter the consignment line's details.");
            if (string.IsNullOrWhiteSpace(line.GdNumber))
                throw new InvalidOperationException("Enter the GD number.");
            if (string.IsNullOrWhiteSpace(line.Description))
                throw new InvalidOperationException("Enter a description.");
            if (line.Quantity <= 0)
                throw new InvalidOperationException("Enter a quantity greater than zero.");
            if (line.AssessedValue < 0 || line.CustomsDuty < 0 || line.Acd < 0
                || line.RegulatoryDuty < 0 || line.Others < 0 || line.AddOnProfit < 0)
                throw new InvalidOperationException("Cost figures cannot be negative.");
            if (line.SalesTaxRate < 0 || line.AstRate < 0 || line.IncomeTaxRate < 0)
                throw new InvalidOperationException("Tax rates cannot be negative.");
            if (line.SellingValue is < 0)
                throw new InvalidOperationException("The stated selling value cannot be negative.");
        }

        /// <summary>
        /// Deterministic stand-in for a file hash: every field of the manual
        /// line (plus the company id, belt-and-braces alongside the DB index's
        /// own CompanyId scoping), joined and SHA-256'd, so <c>ImportRun</c>'s
        /// own (CompanyId, Kind, FileSha256) unique index gives a manual
        /// commit the same "already imported" protection a re-uploaded
        /// workbook gets — an identical line submitted twice collides, a line
        /// differing in any field never does.
        /// </summary>
        private static (string Sha256, long SizeBytes) ManualEntryFingerprint(
            int companyId, IReadOnlyList<GdCostingManualLineDto> lines)
        {
            // Over the WHOLE set, in the order typed: submitting the same lines
            // twice must collide on ImportRun's (CompanyId, Kind, FileSha256)
            // index exactly as re-uploading a workbook does, while adding or
            // editing any one line makes a different consignment. Hashing only
            // the first line would let a second, different set through.
            var canonical = string.Join("~~", lines.Select(l => CanonicalManualLine(companyId, l)));
            var bytes = Encoding.UTF8.GetBytes(canonical);
            var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
            return (hash, bytes.LongLength);
        }

        private static string CanonicalManualLine(int companyId, GdCostingManualLineDto line)
        {
            return string.Join("|",
                companyId.ToString(CultureInfo.InvariantCulture),
                (line.GdNumber ?? "").Trim().ToUpperInvariant(),
                line.GdDate?.ToString("O") ?? "",
                (line.Description ?? "").Trim(),
                GdCostingMapping.CleanHsCode(line.HsCode),
                line.Quantity.ToString(CultureInfo.InvariantCulture),
                (line.Unit ?? "").Trim(),
                line.AssessedValue.ToString(CultureInfo.InvariantCulture),
                line.CustomsDuty.ToString(CultureInfo.InvariantCulture),
                line.Acd.ToString(CultureInfo.InvariantCulture),
                line.RegulatoryDuty.ToString(CultureInfo.InvariantCulture),
                line.Others.ToString(CultureInfo.InvariantCulture),
                line.SalesTaxRate.ToString(CultureInfo.InvariantCulture),
                line.AstRate.ToString(CultureInfo.InvariantCulture),
                line.IncomeTaxRate.ToString(CultureInfo.InvariantCulture),
                line.AddOnProfit.ToString(CultureInfo.InvariantCulture),
                line.SellingValue?.ToString(CultureInfo.InvariantCulture) ?? "");
        }

        // ── Matching, in memory (CLAUDE.md: match per LINE, in C#, not SQL) ──

        private sealed record MatchIndex(
            Dictionary<(string Gd, string Hs), List<int>> ByLot,
            Dictionary<string, List<int>> ByHsCode,
            Dictionary<int, OpeningStockBalance> Balances,
            /// <summary>Balance id -> how many DISTINCT product names the stock
            /// sheet folded into it. Opening stock groups on the HS code
            /// (CLAUDE.md 5b-3), which is right for stock and lossy for costing:
            /// a balance holding four products of different unit value cannot be
            /// described by one unit cost. Read only to explain a warning, never
            /// to decide a match. Costs nothing extra — the lots are already
            /// loaded for ByLot.</summary>
            Dictionary<int, int> MergedProductCounts);

        /// <summary>
        /// The Backfill sanity check: is <paramref name="derivedCost"/> — this
        /// GD's unit cost stretched across the balance's whole quantity — a
        /// figure that could plausibly belong to this stock?
        ///
        /// Compares it against what the balance's own selling value implies via
        /// <see cref="ImportCostingCalculator.ExpectedCostFromSelling"/>. Two
        /// ways to fail, and both are reported with every figure named so the
        /// operator can judge rather than take the system's word:
        ///
        ///   • the projection exceeds the selling value outright — the item
        ///     would be selling below what it cost to land, which is worth
        ///     naming even when it turns out to be true;
        ///   • it sits more than <see cref="CostPlausibilityTolerance"/> away
        ///     from the expected figure.
        ///
        /// The message carries the COVERAGE and, where the stock sheet merged
        /// several products under one HS code, how many — because that is the
        /// actual cause, and it tells the operator the answer is to split the
        /// item rather than to retype a cost.
        ///
        /// Null when there is nothing trustworthy to compare against (no
        /// selling value, or a zero-rated item with no uplift to unwind).
        /// </summary>
        private static string? DescribeImplausibleCost(
            OpeningStockBalance balance, List<int> rowIdxs, List<GdCostingSheetRow> rows,
            decimal totalQty, decimal derivedCost, MatchIndex index)
        {
            if (derivedCost <= 0m || balance.ValueExcludingTax <= 0m) return null;

            // The AST rate lives on the costing side only, so it comes from the
            // lines; weighted by quantity so one dominant line sets it, which
            // reduces to that line's own rate in the ordinary one-line case.
            decimal weighted = 0m;
            foreach (var i in rowIdxs) weighted += rows[i].Quantity * rows[i].Input.AstRate;
            var astRate = totalQty != 0m ? weighted / totalQty : rows[rowIdxs[0]].Input.AstRate;

            var expected = ImportCostingCalculator.ExpectedCostFromSelling(
                balance.ValueExcludingTax, balance.SalesTaxRate, astRate);
            if (expected is not decimal expectedCost || expectedCost <= 0m) return null;

            var overSelling = derivedCost > balance.ValueExcludingTax;
            var deviation = Math.Abs(derivedCost - expectedCost) / expectedCost;
            if (!overSelling && deviation <= CostPlausibilityTolerance) return null;

            var itemName = balance.ItemType?.Name ?? "this item";
            var direction = derivedCost > expectedCost ? "higher" : "lower";
            var lead = overSelling
                ? $"This would cost \"{itemName}\" at {derivedCost:N2}, MORE than the {balance.ValueExcludingTax:N2} it is on the books to sell for."
                : $"This would cost \"{itemName}\" at {derivedCost:N2}, {deviation:P0} {direction} than the {expectedCost:N2} its selling value implies.";

            var why = new List<string>();
            if (Math.Abs(totalQty - balance.Quantity) > 0.0001m)
                why.Add($"this GD prices {FormatQty(totalQty)} of the {FormatQty(balance.Quantity)} on the books, and Backfill applies that unit cost to all of them");

            var mergedProducts = index.MergedProductCounts.TryGetValue(balance.Id, out var n) ? n : 0;
            if (mergedProducts > 1)
                why.Add($"the stock sheet merged {mergedProducts} different products under this one HS code, so one unit cost cannot describe them all — consider splitting the item");

            return why.Count > 0
                ? lead + " Why: " + string.Join("; ", why) + "."
                : lead + " Check the GD covers the same goods as the stock on the books.";
        }

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
            var mergedProductCounts = new Dictionary<int, int>();

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

                // Free: the lots are already loaded above for ByLot. Counts the
                // DISTINCT product names the stock sheet folded under this one
                // HS code -- the reason a single unit cost can be wrong for a
                // balance, and the sentence that tells an operator to split the
                // item rather than retype a figure. Zero for a balance typed by
                // hand or imported before lots were kept, which reads correctly
                // as "nothing known about how this was composed".
                var distinctNames = b.Lots
                    .Select(l => (l.ItemNameOnSheet ?? "").Trim())
                    .Where(n => n.Length > 0)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .Count();
                if (distinctNames > 0) mergedProductCounts[b.Id] = distinctNames;
            }

            return new MatchIndex(byLot, byHsCode, byId, mergedProductCounts);
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
            decimal MatchedBalanceQuantity, decimal DerivedActualCost, string? MatchNote,
            string? OverwriteWarning = null, string? CostPlausibilityWarning = null);

        /// <summary>
        /// How far a Backfill projection may sit from what the balance's own
        /// selling value implies before it is worth an operator's eye. 20% is
        /// wide enough to absorb an add-on profit and a mixed 18%/25% book, and
        /// narrow enough to have flagged 3 of 110 on the first real production
        /// import — the two genuinely mispriced balances and one worth checking.
        /// A threshold that fires on a tenth of the sheet gets ignored, which is
        /// the only way this check can fail.
        /// </summary>
        private const decimal CostPlausibilityTolerance = 0.20m;

        /// <summary>
        /// Rates above this are not rates. A cell holding <c>1</c> cannot be
        /// told apart from a fraction, so <c>PercentRate</c> reads it as 100% —
        /// which is exactly what happened to two lines of a real sheet whose
        /// income tax should have been 1%. No GD carries a 50% rate of anything.
        /// </summary>
        private const decimal ImplausibleRateThreshold = 50m;

        /// <summary>
        /// Resolves every line's disposition. A balance matched by exactly one
        /// line's worth of candidates is grouped with every OTHER line in the
        /// sheet (any GD) that resolves to the same balance, because the unit
        /// cost the brief specifies —
        /// <c>unitCost = SUM(line.Cost) / SUM(line.Quantity)</c> — is meant to
        /// be trustworthy across the whole sheet, not one GD at a time.
        ///
        /// <paramref name="mode"/> (one of <see cref="GdCostingImportModeNames"/>)
        /// decides only how a matched (cost-only) group's
        /// <c>DerivedActualCost</c>/<c>MatchNote</c> are worded — it never
        /// changes WHICH lines match, since preview writes nothing either
        /// way. <see cref="GdCostingImportService.CommitAsync"/> mirrors this
        /// same branch when it actually writes the balance.
        /// </summary>
        private static LineOutcome[] MatchAll(List<GdCostingSheetRow> rows, MatchIndex index, string mode)
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

            var newArrivals = mode == GdCostingImportModeNames.NewArrivals;

            foreach (var (balanceId, rowIdxs) in byBalance)
            {
                var balance = index.Balances[balanceId];
                var totalCost = rowIdxs.Sum(i => rows[i].Computed.Cost);
                var totalQty = rowIdxs.Sum(i => rows[i].Quantity);

                decimal derivedCost;
                string? note;
                string? overwriteWarning = null;
                string? plausibilityWarning = null;

                if (newArrivals)
                {
                    // New Arrivals ADDS rather than SETS, so the "unit cost
                    // applied to the whole balance" framing below no longer
                    // describes what will happen — quantity is moving too.
                    // DerivedActualCost instead previews the balance's own
                    // resulting TOTAL cost, and the note always states the
                    // add (never conditional on a quantity mismatch, unlike
                    // Backfill's note) because under this mode EVERY match
                    // changes the balance — this is the operator's one
                    // warning before commit (brief, Task 19).
                    derivedCost = Math.Round(balance.ActualCostExcludingTax + totalCost, 2, MidpointRounding.AwayFromZero);
                    note = $"Adds {FormatQty(totalQty)} to the {FormatQty(balance.Quantity)} already on the books (new total {FormatQty(balance.Quantity + totalQty)}).";
                }
                else
                {
                    // The unit cost is the trustworthy figure from the GD; the
                    // quantity is the trustworthy figure from the books (brief,
                    // Task 10 step 2). A balance quantity of zero derives zero
                    // through the multiplication below without any special case.
                    var unitCost = totalQty != 0m ? totalCost / totalQty : 0m;
                    derivedCost = Math.Round(unitCost * balance.Quantity, 2, MidpointRounding.AwayFromZero);

                    note = Math.Abs(totalQty - balance.Quantity) > 0.0001m
                        ? $"This GD covers {FormatQty(totalQty)} of the {FormatQty(balance.Quantity)} on the books; its unit cost was applied to the whole balance."
                        : null;

                    // Finding 3 (2026-09-13 architecture review): nothing
                    // previously stopped a second Backfill from silently
                    // replacing a cost an earlier GD already wrote — 26 real
                    // opening balances across two companies ended up costed by
                    // only their LAST consignment's rate applied to the whole
                    // accumulated quantity. Warn, but do not block: a
                    // deliberate re-backfill after a correction is legitimate.
                    if (balance.ActualCostExcludingTax != 0m)
                        overwriteWarning =
                            $"This balance already carries an actual cost of {balance.ActualCostExcludingTax:N2} " +
                            "from an earlier import. Backfill will REPLACE it. Choose \"These are new arrivals\" " +
                            "if these are additional goods.";

                    // Does the projected figure actually FIT the stock it is
                    // about to be written onto? Backfill extrapolates one unit
                    // cost across a whole balance, which is only sound while the
                    // goods the GD priced are representative of the goods on the
                    // books. See the DTO for the production case that was not.
                    plausibilityWarning = DescribeImplausibleCost(
                        balance, rowIdxs, rows, totalQty, derivedCost, index);
                }

                var outcome = new LineOutcome(
                    GdCostingDispositionNames.CostOnly, balance.Id, balance.ItemTypeId, balance.ItemType?.Name,
                    balance.Quantity, derivedCost, note, overwriteWarning, plausibilityWarning);

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

        /// <summary>
        /// Names any rate on this row that is too large to be a rate. See
        /// <see cref="ImplausibleRateThreshold"/> for why 50%, and the DTO's
        /// <c>RateWarning</c> for the real sheet that needed this.
        ///
        /// Runs on EVERY line, matched or not, and independently of mode: a
        /// misread rate is a property of the row, not of what it matched.
        /// </summary>
        private static string? DescribeImplausibleRates(GdCostingSheetRow row)
        {
            var bad = new List<string>();
            if (row.Input.SalesTaxRate >= ImplausibleRateThreshold)
                bad.Add($"sales tax {row.Input.SalesTaxRate:0.##}%");
            if (row.Input.AstRate >= ImplausibleRateThreshold)
                bad.Add($"AST {row.Input.AstRate:0.##}%");
            if (row.Input.IncomeTaxRate >= ImplausibleRateThreshold)
                bad.Add($"income tax {row.Input.IncomeTaxRate:0.##}%");
            if (bad.Count == 0) return null;

            return $"Rate looks misread: {string.Join(", ", bad)}. A cell holding \"1\" cannot be told "
                 + "apart from a fraction and reads as 100% — write 1% as 0.01 or as the text \"1%\". "
                 + "Cost and selling value are unaffected; income tax is not.";
        }

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
            OverwriteWarning = outcome.OverwriteWarning,
            CostPlausibilityWarning = outcome.CostPlausibilityWarning,
            RateWarning = DescribeImplausibleRates(row),
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
                    $"GD {string.Join(", ", existingGds)} already {(existingGds.Count == 1 ? "has" : "have")} a consignment recorded for this company. Nothing was changed. Open the Consignments screen and delete the existing one first if you need to re-import it.");

            // Task 19: never trusted beyond deciding SET vs ADD below — this
            // has no bearing on matching, verification or either duplicate
            // guard just above/below, all of which run identically in both
            // modes.
            var mode = GdCostingImportModeNames.Normalize(dto.Mode);

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
                        // Stored so a later delete (Task 21) knows whether a
                        // matched line's cost was SET (Backfill) or ADDED
                        // (New Arrivals) without having to guess after the fact.
                        Mode = mode,
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

                // Figures are derived here from the WRITTEN entities' own
                // (server-recomputed, verified) Cost/Quantity/SellingValue —
                // never from the client's claimed DerivedActualCost, and
                // never from the client's raw Cost either, now that each
                // line's CostExcludingTax above is itself the recomputed
                // figure. Each is an AGGREGATE over however many lines
                // matched one balance; trusting a per-line copy of a shared
                // figure invites a "last line wins" bug the moment two lines
                // disagree.
                foreach (var balanceId in costedBalanceIds)
                {
                    var balance = index.Balances[balanceId];
                    var matching = writtenLines.Where(e =>
                        e.Disposition == GdCostingDisposition.CostOnly && e.OpeningStockBalanceId == balanceId).ToList();

                    var totalCost = matching.Sum(e => e.CostExcludingTax);
                    var totalQty = matching.Sum(e => e.Quantity);

                    // Snapshot before either branch writes. Backfill OVERWRITES
                    // the cost outright, so without this there is no record
                    // anywhere of what the figure had been -- the single
                    // question this audit trail exists to answer.
                    var costedBefore = new StockFigures(
                        balance.Quantity, balance.ActualCostExcludingTax, balance.ValueExcludingTax);
                    var costedGdNumbers = string.Join(", ", matching
                        .Select(e => consignmentsByGd.Values.FirstOrDefault(c => c.Id == e.ImportConsignmentId)?.GdNumber)
                        .Where(g => !string.IsNullOrWhiteSpace(g))
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .OrderBy(g => g, StringComparer.OrdinalIgnoreCase));

                    if (mode == GdCostingImportModeNames.NewArrivals)
                    {
                        // New arrivals: this GD brings MORE of what is
                        // already on the books. ADD rather than SET, on all
                        // three figures together — quantity and cost move in
                        // step so the stored cost stays the total cost of the
                        // total quantity (a genuine weighted average per
                        // unit), and the selling value is added in step too,
                        // or a month-2 arrival would inflate cost and
                        // quantity while margin silently collapsed (brief,
                        // Task 19).
                        var totalSellingValue = matching.Sum(e => e.SellingValueExcludingTax);
                        balance.Quantity += totalQty;
                        balance.ActualCostExcludingTax = Money(balance.ActualCostExcludingTax + totalCost);
                        balance.ValueExcludingTax = Money(balance.ValueExcludingTax + totalSellingValue);
                    }
                    else
                    {
                        // Backfill (default, and byte-identical to every
                        // release before this one): this GD is pricing stock
                        // ALREADY on the books. SET the cost from this GD's
                        // own unit cost applied to the WHOLE balance
                        // quantity; Quantity and ValueExcludingTax are never
                        // touched. Same formula as preview's Backfill branch,
                        // applied to exactly the lines that verified as
                        // cost-only for this balance.
                        var unitCost = totalQty != 0m ? totalCost / totalQty : 0m;
                        balance.ActualCostExcludingTax = Math.Round(unitCost * balance.Quantity, 2, MidpointRounding.AwayFromZero);
                    }

                    await _costAudit.RecordAsync(
                        dto.CompanyId, balance.ItemTypeId, balance.Id, userId,
                        StockCostChangeSources.GdCostingImport, costedGdNumbers,
                        costedBefore,
                        new StockFigures(balance.Quantity, balance.ActualCostExcludingTax, balance.ValueExcludingTax),
                        note: mode == GdCostingImportModeNames.NewArrivals
                            ? $"New Arrivals: {matching.Count} GD line(s) added {totalQty:0.####} unit(s) at a landed cost of {totalCost:N2}."
                            : $"Backfill: {matching.Count} GD line(s) priced {totalQty:0.####} unit(s) at {totalCost:N2}; "
                              + $"that unit cost was applied to the balance's own {balance.Quantity:0.####} unit(s).",
                        importConsignmentId: matching[0].ImportConsignmentId);
                }

                // Task 15, opt-in only: lines the server independently proved
                // touch nothing on the books become new stock here — never
                // inline in the loop above, because a group sharing one
                // (HsCode, Name) target needs every member's own recomputed
                // Cost/SellingValue collected first.
                var (itemTypesCreated, itemTypesAdopted, openingBalancesCreated, newStockValue) =
                    await CreateMissingStockAsync(dto.CompanyId, newStockLines, userId);

                // The value that stock brought onto the books belongs on the
                // Inventory control account, the same way a stock sheet's does.
                // Inside the transaction, so a rollback takes the account back
                // with everything else.
                var inventoryOpeningPosted =
                    await PostCreatedStockToInventoryAsync(dto.CompanyId, newStockValue, result);

                // Costing rewrites what stock is WORTH, and new opening balances
                // change the pool every later sale is costed from — so the
                // monthly stock-relief entries are recomputed from the start.
                // Null rather than a date: a costing run can touch balances of
                // any vintage, and these books are small enough that a full
                // recompute is cheaper than working out the earliest one.
                await _posting.PostInventoryPeriodsAsync(dto.CompanyId, null);

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

                // GL posting (Task 20). New Arrivals only — a Backfill GD is
                // re-pricing stock already accounted for, so posting its tax
                // and liability now would claim tax in the wrong period and
                // invent a payable settled long ago (full reasoning on
                // IPostingService.PostImportConsignmentAsync itself). Inside
                // the SAME transaction as everything above: a posting failure
                // must roll the whole commit back — a consignment recorded
                // with no entry, or an entry with no consignment, is worse
                // than a refused import.
                var postedEntries = new List<GdCostingJournalEntryDto>();
                if (mode == GdCostingImportModeNames.NewArrivals)
                {
                    foreach (var consignment in consignmentsByGd.Values)
                        await _posting.PostImportConsignmentAsync(consignment);

                    // Read back what actually posted rather than assuming every
                    // consignment did — PostImportConsignmentAsync is a no-op
                    // when GL posting is off for this company, or when every
                    // line in a given GD is Skipped/Ambiguous, so this can
                    // legitimately come back shorter than consignmentsByGd.
                    var consignmentIds = consignmentsByGd.Values.Select(c => c.Id).ToList();
                    var gdNumberByConsignmentId = consignmentsByGd.Values
                        .ToDictionary(c => c.Id, c => c.GdNumber);
                    var posted = await _db.JournalEntries.AsNoTracking()
                        .Where(e => e.CompanyId == dto.CompanyId
                                 && e.SourceDocType == SourceDocType.ImportConsignment
                                 && e.SourceDocId.HasValue
                                 && consignmentIds.Contains(e.SourceDocId.Value))
                        .Select(e => new { e.Id, e.SourceDocId, Total = e.Lines.Sum(l => l.Debit) })
                        .ToListAsync();
                    foreach (var p in posted)
                        postedEntries.Add(new GdCostingJournalEntryDto
                        {
                            JournalEntryId = p.Id,
                            GdNumber = gdNumberByConsignmentId.GetValueOrDefault(p.SourceDocId!.Value, ""),
                            Amount = p.Total,
                        });
                }

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
                result.InventoryOpeningPosted = inventoryOpeningPosted;
                result.JournalEntries = postedEntries;
                result.TotalPosted = Money(postedEntries.Sum(e => e.Amount));

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
                if (result.JournalEntries.Count > 0)
                    result.Messages.Add(
                        $"{result.JournalEntries.Count} journal entr{(result.JournalEntries.Count == 1 ? "y" : "ies")} posted to the general ledger, totalling {result.TotalPosted:N2}.");

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
        ///
        /// It DOES report the selling value it brought onto the books, so the
        /// caller can put that on the Inventory control account's opening
        /// balance — see <see cref="PostCreatedStockToInventoryAsync"/>. That
        /// is an opening balance, not a journal entry, so the boundary above
        /// still holds.
        /// </summary>
        private async Task<(int Created, int Adopted, int BalancesCreated, decimal ValueCreated)>
            CreateMissingStockAsync(
            int companyId,
            List<(ImportConsignmentLine Entity, NewStockGroupKey Key, GdCostingLineDto Line)> newStockLines,
            int userId)
        {
            if (newStockLines.Count == 0) return (0, 0, 0, 0m);

            var itemTypesCreated = 0;
            var itemTypesAdopted = 0;
            var openingBalancesCreated = 0;
            var valueCreated = 0m;

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

            if (resolved.Count == 0) return (itemTypesCreated, itemTypesAdopted, 0, 0m);

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
                // Zero on the create path, which is what "this item had no
                // position" has always meant here -- so the history reads as
                // 0 -> the imported figures rather than as an unexplained jump.
                var newStockBefore = balance == null
                    ? new StockFigures(0m, 0m, 0m)
                    : new StockFigures(balance.Quantity, balance.ActualCostExcludingTax, balance.ValueExcludingTax);
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
                    valueCreated += totalValue;
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
                    // Value arriving on an EXISTING balance is just as new to
                    // the books as a created one, so it belongs on the
                    // Inventory account too.
                    valueCreated += totalValue;
                }

                await _costAudit.RecordAsync(
                    companyId, itemType.Id, balance.Id, userId,
                    StockCostChangeSources.GdCostingImport,
                    gdNumbers.Count > 0 ? string.Join(", ", gdNumbers) : null,
                    newStockBefore,
                    new StockFigures(balance.Quantity, balance.ActualCostExcludingTax, balance.ValueExcludingTax),
                    note: $"New stock created from {members.Count} unmatched GD line(s): "
                        + $"{totalQty:0.####} unit(s), landed cost {totalCost:N2}, selling value {totalValue:N2}.",
                    importConsignmentId: members[0].Entity.ImportConsignmentId);

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

            return (itemTypesCreated, itemTypesAdopted, openingBalancesCreated, Money(valueCreated));
        }

        /// <summary>
        /// Puts the value of the opening stock this import CREATED onto the
        /// company's Inventory control account, exactly as
        /// <c>OpeningStockImportService.PostInventoryValueAsync</c> does for a
        /// stock sheet. Without this the two importers disagree: a stock sheet
        /// reaches the Chart of Accounts and a GD costing sheet does not, so
        /// "Inventory on hand" silently understates the books by the value of
        /// every balance a costing import brought in (found on the importer
        /// production line 2026-09-17 — two companies, 3,028,198.61 between
        /// them).
        ///
        /// ADDITIVE on purpose. The account already carries whatever an
        /// earlier import put there, and
        /// <see cref="IAccountService.AdjustOpeningBalanceAsync"/> takes an
        /// ABSOLUTE figure — so the delta is added to the current opening
        /// rather than replacing it. Passing the raw value here would wipe the
        /// stock sheet's own contribution.
        ///
        /// Still no journal entry: an opening position is not a movement
        /// (see <see cref="CreateMissingStockAsync"/>). The contra side goes
        /// to Retained earnings inside AdjustOpeningBalanceAsync, so the
        /// opening balance sheet stays balanced without anything being posted
        /// here.
        /// </summary>
        private async Task<decimal> PostCreatedStockToInventoryAsync(
            int companyId, decimal valueCreated, GdCostingCommitResultDto result)
        {
            if (valueCreated <= 0m) return 0m;

            var inventory = await _db.Accounts.AsNoTracking()
                .Where(a => a.CompanyId == companyId
                         && a.ControlType == ControlType.Inventory
                         && a.IsActive)
                .OrderBy(a => a.Id)
                .Select(a => new { a.Id, a.Name })
                .FirstOrDefaultAsync();

            if (inventory == null)
            {
                result.Messages.Add(
                    "No Inventory account was found, so the value of the new opening stock was not "
                    + "posted. Seed the chart of accounts, then set it by hand.");
                return 0m;
            }

            // Shared with the stock-sheet importer and the manual opening-balance
            // endpoint. Additive, and offsets to Retained earnings.
            await _posting.AdjustInventoryOpeningAsync(companyId, valueCreated);

            result.Messages.Add(
                $"{valueCreated:N2} added to {inventory.Name} for the opening stock this import created.");
            return valueCreated;
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
