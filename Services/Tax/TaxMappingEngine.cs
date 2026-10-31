using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Tax
{
    /// <summary>
    /// Default implementation. Talks to FbrService for live reference data,
    /// caches results aggressively (HS_UOM, SaleTypeToRate are expensive and
    /// change rarely), and delegates scenario rules to TaxScenarios.
    /// </summary>
    public class TaxMappingEngine : ITaxMappingEngine
    {
        private readonly IFbrService _fbr;
        private readonly AppDbContext _db;
        private readonly ILogger<TaxMappingEngine>? _logger;

        // HS code -> units, process lifetime. The stored copy in FbrLookups
        // (see GetValidUomsForHsCodeAsync) is what survives a restart.
        private static readonly ConcurrentDictionary<string, List<FbrUOMDto>> _hsUomCache = new();
        private static readonly ConcurrentDictionary<string, List<FbrSaleTypeRateDto>> _saleTypeRateCache = new();

        // FBR's HS_UOM endpoint requires an annexure id. 3 = "Sales of goods"
        // which covers >99 % of our use cases. Services / 6th-schedule items
        // would use 5/7 but we don't sell those today.
        private const int DefaultAnnexureId = 3;

        // PRAL's HS_UOM endpoint intermittently returns an empty array on the
        // first call for an otherwise-valid HS code (operators reported the
        // "no UOM found" warning for 8311.3000 clearing on the 2nd or 3rd
        // re-pick). Retry locally with a small backoff so the first
        // user-visible response is consistent. HS_UOM is an idempotent GET,
        // so retry is safe — the CLAUDE.md "no POST retries" rule only
        // covers /submit and /validate which can issue duplicate IRNs.
        private const int HsUomMaxAttempts = 3;
        private static readonly int[] HsUomBackoffMs = new[] { 0, 250, 600 };

        // FBR's SaleTypeToRate endpoint requires a transaction-type id.
        // 18 = "Goods sale" (the only one in use today). Reserved for future
        // override when other sectors come online (services, exports).
        private const int DefaultTransactionTypeId = 18;

        public TaxMappingEngine(IFbrService fbr, AppDbContext db, ILogger<TaxMappingEngine>? logger = null)
        {
            _fbr = fbr;
            _db = db;
            _logger = logger;
        }

        // ─── HS_UOM ────────────────────────────────────────────────

        // FBR's HS_UOM answer belongs to the HS code, not to a company, so it is kept
        // once for the whole installation in FbrLookups (Category "HsUom", Code
        // "<hs>|<uomId>", Label = unit name, SortOrder = FBR's order) beside the stored
        // HS list. Order of lookup: memory, stored table, then PRAL with the asking
        // company's own token; a good PRAL answer is stored, so each code is slow once.
        public const string HsUomCategory = "HsUom";
        public const string SaleTypeRateCategory = "SaleTypeRate";

        public async Task<List<FbrUOMDto>> GetValidUomsForHsCodeAsync(int companyId, string hsCode)
        {
            if (string.IsNullOrWhiteSpace(hsCode)) return new();

            var trimmed = hsCode.Trim();
            if (_hsUomCache.TryGetValue(trimmed, out var cached)) return cached;

            var stored = await LoadStoredUomsAsync(trimmed);
            if (stored.Count > 0)
            {
                _hsUomCache.TryAdd(trimmed, stored);
                return stored;
            }

            // Retry-on-empty: PRAL occasionally returns an empty array on the
            // first call for a real HS code (operator-reported, see comment
            // on HsUomMaxAttempts). Second attempt almost always succeeds.
            // We only retry the empty case — a 4xx / 5xx surfaces as an
            // exception through Polly's HttpClient pipeline and never reaches
            // here, so this loop won't paper over real network failures.
            List<FbrUOMDto>? fresh = null;
            for (var attempt = 0; attempt < HsUomMaxAttempts; attempt++)
            {
                if (HsUomBackoffMs[attempt] > 0)
                    await Task.Delay(HsUomBackoffMs[attempt]);
                fresh = await _fbr.GetHSCodeUOMAsync(companyId, trimmed, DefaultAnnexureId);
                if (fresh != null && fresh.Count > 0)
                {
                    if (attempt > 0)
                        _logger?.LogWarning(
                            "PRAL HS_UOM returned empty on attempt 1 for HS {HsCode} (company {CompanyId}); recovered on attempt {Attempt}.",
                            trimmed, companyId, attempt + 1);
                    _hsUomCache.TryAdd(trimmed, fresh);
                    await StoreUomsAsync(trimmed, fresh);
                    return fresh;
                }
            }
            return fresh ?? new();
        }

        private async Task<List<FbrUOMDto>> LoadStoredUomsAsync(string hsCode)
        {
            var prefix = hsCode + "|";
            var rows = await _db.FbrLookups.AsNoTracking()
                .Where(l => l.Category == HsUomCategory && l.IsActive && l.Code.StartsWith(prefix))
                .OrderBy(l => l.SortOrder).ToListAsync();
            var list = new List<FbrUOMDto>();
            foreach (var r in rows)
                if (int.TryParse(r.Code[prefix.Length..], out var id))
                    list.Add(new FbrUOMDto { UOM_ID = id, Description = r.Label });
            return list;
        }

        // Plain INSERT ... WHERE NOT EXISTS, never SaveChanges: the caller may be
        // mid-edit with tracked changes that must not be flushed from here, and two
        // requests storing the same code at once must not duplicate it.
        private async Task StoreUomsAsync(string hsCode, List<FbrUOMDto> uoms)
        {
            try
            {
                var order = 0;
                foreach (var u in uoms)
                {
                    var code = $"{hsCode}|{u.UOM_ID}";
                    var label = (u.Description ?? "").Trim();
                    var sort = order++;
                    await _db.Database.ExecuteSqlInterpolatedAsync($@"
INSERT INTO FbrLookups (Category, Code, Label, SortOrder, IsActive)
SELECT {HsUomCategory}, {code}, {label}, {sort}, 1
WHERE NOT EXISTS (SELECT 1 FROM FbrLookups WHERE Category = {HsUomCategory} AND Code = {code})");
                }
            }
            catch (Exception ex)
            {
                // Storing is an optimisation; the live answer is still returned.
                _logger?.LogWarning(ex, "Could not store FBR units for HS {HsCode}", hsCode);
            }
        }

        public async Task<FbrUOMDto?> SuggestDefaultUomAsync(int companyId, string hsCode)
        {
            var uoms = await GetValidUomsForHsCodeAsync(companyId, hsCode);
            return uoms.FirstOrDefault();
        }

        // ─── SaleTypeToRate (used to validate the rate + sale-type combo) ───

        private async Task<List<FbrSaleTypeRateDto>> GetSaleTypeRatesAsync(
            int companyId, DateTime date, int? provinceCode)
        {
            var province = provinceCode ?? 0;
            var dateStr = date.ToString("yyyy-MM-dd");
            // FBR's rates depend on transaction type, province and date, not on the company, like HS units.
            var key = $"{DefaultTransactionTypeId}|{province}|{dateStr}";
            if (_saleTypeRateCache.TryGetValue(key, out var cached)) return cached;

            // The host recycles the app after a few idle minutes, emptying the static cache; without a
            // stored copy every first lookup after that waited 2-5 s on FBR (Adjust Invoice, every row).
            var stored = await _db.FbrLookups.AsNoTracking()
                .Where(l => l.Category == SaleTypeRateCategory && l.Code == key)
                .Select(l => l.Label).FirstOrDefaultAsync();
            if (stored != null && JsonSerializer.Deserialize<List<FbrSaleTypeRateDto>>(stored) is { Count: > 0 } kept)
            {
                _saleTypeRateCache.TryAdd(key, kept);
                return kept;
            }

            var fresh = await _fbr.GetSaleTypeRatesAsync(
                companyId, dateStr, DefaultTransactionTypeId, province);
            if (fresh != null && fresh.Count > 0)
            {
                _saleTypeRateCache.TryAdd(key, fresh);
                await StoreSaleTypeRatesAsync(key, fresh);
            }
            return fresh ?? new();
        }

        // ponytail: one row per transaction type, province and day, never pruned (a few hundred bytes a
        // day); delete old SaleTypeRate rows if that ever matters. Same INSERT ... WHERE NOT EXISTS as units.
        private async Task StoreSaleTypeRatesAsync(string key, List<FbrSaleTypeRateDto> rates)
        {
            try
            {
                var json = JsonSerializer.Serialize(rates);
                await _db.Database.ExecuteSqlInterpolatedAsync($@"
INSERT INTO FbrLookups (Category, Code, Label, SortOrder, IsActive)
SELECT {SaleTypeRateCategory}, {key}, {json}, 0, 1
WHERE NOT EXISTS (SELECT 1 FROM FbrLookups WHERE Category = {SaleTypeRateCategory} AND Code = {key})");
            }
            catch (Exception ex)
            {
                // Storing is an optimisation; the live answer is still returned.
                _logger?.LogWarning(ex, "Could not store FBR sale type rates for {Key}", key);
            }
        }

        // ─── Resolve ───────────────────────────────────────────────

        public Task<TaxResolution> ResolveAsync(TaxResolutionInput input)
        {
            var notes = new List<string>();

            // 1) Find scenario — explicit code wins; otherwise infer from rate+buyer+sale type.
            var scenario = TaxScenarios.Find(input.ScenarioCode);
            if (scenario == null)
            {
                var isThirdSched = string.Equals(
                    input.SaleTypeOverride, "3rd Schedule Goods", StringComparison.OrdinalIgnoreCase);
                scenario = TaxScenarios.InferFromFacts(input.Rate, input.BuyerRegistrationType, isThirdSched);
                if (scenario != null)
                    notes.Add($"Inferred scenario {scenario.Code} from rate {input.Rate}% / {input.BuyerRegistrationType} / 3rd-Schedule={isThirdSched}.");
                else
                    notes.Add($"No scenario inferred; falling back to {TaxScenarios.DefaultCode}.");
            }
            scenario ??= TaxScenarios.Find(TaxScenarios.DefaultCode)!;

            // 2) Sale type — operator override wins (they may know the SRO better than us);
            //    otherwise the scenario fixes it.
            var saleType = !string.IsNullOrWhiteSpace(input.SaleTypeOverride)
                ? input.SaleTypeOverride!
                : scenario.SaleType;

            // 3) Rate — when the operator's bill rate doesn't match the scenario's
            //    canonical rate, prefer the operator's number (they're closer to the
            //    customer) but flag it so reviewers see the mismatch.
            var rate = input.Rate;
            if (rate != scenario.DefaultRate)
                notes.Add($"Bill rate {rate}% differs from scenario {scenario.Code} default ({scenario.DefaultRate}%).");

            // 4) SRO reference — required when rate ≠ 18% (FBR rule 0077). Scenario
            //    catalog supplies a known-good fallback (SN028 → Eighth Schedule
            //    Table 1 / serial 70).
            string? sroSchedule = scenario.DefaultSroScheduleNo;
            string? sroItem = scenario.DefaultSroItemSerialNo;
            if (rate != 18m && string.IsNullOrEmpty(sroSchedule))
                notes.Add("Rate ≠ 18% but no SRO Schedule on the scenario — operator must set SroScheduleNo + SroItemSerialNo on the line.");

            return Task.FromResult(new TaxResolution(
                SaleType: saleType,
                Rate: rate,
                SroScheduleNo: sroSchedule,
                SroItemSerialNo: sroItem,
                ScenarioCode: scenario.Code,
                IsThirdSchedule: scenario.IsThirdSchedule,
                IsEndConsumerRetail: scenario.IsEndConsumerRetail,
                Notes: notes
            ));
        }

        // ─── Validation ────────────────────────────────────────────
        //
        // Mirrors what FBR rejects on its side, but locally — so the user
        // sees a single clear message instead of a cryptic 0052/0077/0102.

        public async Task<List<string>> ValidateCombinationAsync(
            TaxResolutionInput input, decimal lineTotal, decimal? retailPrice)
        {
            var errors = new List<string>();
            var resolved = await ResolveAsync(input);

            // (a) HS code is mandatory.
            if (string.IsNullOrWhiteSpace(input.HsCode))
                errors.Add("HS Code is required for FBR submission. [pre-flight 0019]");
            else
            {
                // (b) HS_UOM check — block locally what FBR would reject as 0099
                //     (UoM not allowed against the provided HS Code). FBR keeps a
                //     master mapping at HS_UOM(hs_code, annexure_id=3); this checks
                //     that the line's UoM is in that list before we round-trip.
                //     Skipped when FBR has no mapping for the code (newer HS codes
                //     return an empty list — let the live submission be the source
                //     of truth there) and when the line itself doesn't carry a UoM
                //     yet (handled by other validation).
                var validUoms = await GetValidUomsForHsCodeAsync(input.CompanyId, input.HsCode);
                if (validUoms.Count > 0
                    && (input.FbrUomId.HasValue || !string.IsNullOrWhiteSpace(input.Uom)))
                {
                    // Match on FbrUomId first (numeric, unambiguous) and fall
                    // back to a case-insensitive description match. FBR's
                    // descriptions vary in casing across endpoints ("KG" vs
                    // "Kg") so we normalise both sides.
                    bool ok = false;
                    if (input.FbrUomId.HasValue)
                        ok = validUoms.Any(u => u.UOM_ID == input.FbrUomId.Value);
                    if (!ok && !string.IsNullOrWhiteSpace(input.Uom))
                        ok = validUoms.Any(u => string.Equals(
                            (u.Description ?? "").Trim(),
                            input.Uom!.Trim(),
                            StringComparison.OrdinalIgnoreCase));

                    if (!ok)
                    {
                        var allowed = string.Join(", ", validUoms.Select(u => u.Description));
                        var actual = !string.IsNullOrWhiteSpace(input.Uom)
                            ? $"'{input.Uom}'"
                            : $"FbrUOMId={input.FbrUomId}";
                        errors.Add(
                            $"UoM {actual} is not allowed for HS Code {input.HsCode}. " +
                            $"FBR accepts: {allowed}. " +
                            "Update the Item Type's UoM to one of these and re-save the bill. [pre-flight 0099]");
                    }
                }
            }

            // (c) Rate ≠ 18 % requires SRO references (FBR 0077/0078) — EXCEPT
            //     for sale types FBR itself accepts at a non-standard rate with
            //     no SRO. Per PRAL's SN016 (Processing/Conversion, 5%) and SN017
            //     (Goods FED in ST Mode, 8%) sample payloads, neither carries an
            //     SRO schedule/serial, so demanding one here is a false positive.
            var stForSro = resolved.SaleType ?? "";
            bool sroNotRequired =
                   stForSro.IndexOf("Processing", StringComparison.OrdinalIgnoreCase) >= 0
                || stForSro.IndexOf("Conversion", StringComparison.OrdinalIgnoreCase) >= 0
                || stForSro.IndexOf("FED", StringComparison.OrdinalIgnoreCase) >= 0;
            if (resolved.Rate != 18m
                && !sroNotRequired
                && string.IsNullOrWhiteSpace(resolved.SroScheduleNo))
            {
                errors.Add($"Rate {resolved.Rate}% requires SRO Schedule reference. [pre-flight 0077]");
            }

            // (d) 3rd Schedule items must have FixedNotifiedValueOrRetailPrice > 0
            //     (FBR 0090).
            if (resolved.IsThirdSchedule && (retailPrice ?? 0m) <= 0m)
                errors.Add("3rd Schedule items require Fixed/Notified Value or Retail Price (MRP × qty). [pre-flight 0090]");

            // (e) Line total must be > 0 (FBR 0021).
            if (lineTotal <= 0m)
                errors.Add("Line total must be greater than zero. [pre-flight 0021]");

            return errors;
        }

        // ─── HS-Code hints (UOM + rate + sale-type suggestions) ──────
        //
        // Single call the Item Type form makes when the operator types an
        // HS code. Returns enough context for the form to pre-fill UOM,
        // suggest a sale type, and show a rate options list.
        //
        // Three layers of suggestion, first non-empty wins:
        //   1) Live SaleTypeToRate (province + today) — authoritative rate
        //      list for goods sale (transactionType = 18)
        //   2) Company.FbrDefaultSaleType — operator-configured per-company
        //      preference
        //   3) Hard fallback — Goods at Standard Rate (default) at 18 %
        //
        // Catches a wider FBR validation surface BEFORE the bill is built,
        // so the operator never wonders "is 18 % right for this HS code?"
        public async Task<HsCodeHints> GetHsCodeHintsAsync(int companyId, string hsCode)
        {
            var notes = new List<string>();

            // Sequential by necessity: AppDbContext is not thread-safe
            // and every downstream call (GetValidUomsForHsCodeAsync,
            // GetSaleTypeRatesAsync) re-loads the company through the
            // same scoped _db via _companyRepo.GetByIdAsync to fetch the
            // FBR token. Running them in parallel triggers "A second
            // operation was started on this context instance" on any
            // cold-cache request. A prior attempt to parallelise here
            // (2026-05-14) caused 500s on /api/itemtypes/fbr-hints; if
            // we want the parallel-PRAL win, plumb the resolved company
            // / token through FbrService first so the inner DB reads
            // disappear, then it's safe to overlap.
            var company = await _db.Companies.AsNoTracking()
                .FirstOrDefaultAsync(c => c.Id == companyId);

            var uoms = await GetValidUomsForHsCodeAsync(companyId, hsCode);
            var defaultUom = uoms.FirstOrDefault();

            var rateOptions = new List<RateOption>();
            if (company?.FbrProvinceCode != null)
            {
                try
                {
                    var rates = await GetSaleTypeRatesAsync(
                        companyId, DateTime.UtcNow.Date, company.FbrProvinceCode);
                    rateOptions = rates
                        .Select(r => new RateOption(r.RATE_ID, r.RATE_DESC, r.RATE_VALUE))
                        .ToList();
                    if (rateOptions.Count > 0)
                        notes.Add($"FBR returned {rateOptions.Count} valid rate option(s) for goods sale in this province today.");
                }
                catch
                {
                    notes.Add("Could not fetch live SaleTypeToRate (token / network) — falling back to company defaults.");
                }
            }
            else
            {
                notes.Add("Company has no FBR province set — cannot query SaleTypeToRate. Set Province on the Company form to get authoritative rate options.");
            }

            // 2) HS-prefix heuristic — does this HS code fall into a
            //    well-known non-standard scenario (petroleum, EV, mobile,
            //    services, 3rd Schedule FMCG, etc.)? If yes, the scenario
            //    fixes both the sale type and the rate, overriding the
            //    generic SN001 default. See Services/Tax/HsPrefixHeuristics.cs
            //    for the table.
            var heuristicScenario = HsPrefixHeuristics.Match(hsCode);

            // 3) Pick the default sale-type / rate.
            //  - HS-prefix heuristic wins (most specific to the HS code).
            //  - Else company.FbrDefaultSaleType (operator-configured per
            //    company preference).
            //  - Else scenarios catalog SN001 (standard rate B2B).
            string defaultSaleType;
            decimal defaultRate;
            if (heuristicScenario != null)
            {
                defaultSaleType = heuristicScenario.SaleType;
                defaultRate = heuristicScenario.DefaultRate;
                notes.Add($"HS code maps to FBR scenario {heuristicScenario.Code} ({heuristicScenario.Description}). Default rate {defaultRate}%.");
            }
            else
            {
                defaultSaleType = !string.IsNullOrWhiteSpace(company?.FbrDefaultSaleType)
                    ? company!.FbrDefaultSaleType!
                    : TaxScenarios.Find(TaxScenarios.DefaultCode)?.SaleType
                      ?? "Goods at Standard Rate (default)";

                // 18 % is correct for SN001/SN002. If FBR returned an
                // explicit 18 % option we use that ratE_VALUE (handles
                // future budget shifts).
                defaultRate = rateOptions
                    .FirstOrDefault(r => r.RateValue == 18m)?.RateValue
                    ?? rateOptions.FirstOrDefault()?.RateValue
                    ?? 18m;
            }

            if (defaultRate != 18m && heuristicScenario == null)
                notes.Add($"FBR's standard rate today is {defaultRate}%, not 18%. Verify before saving.");

            return new HsCodeHints(
                Uoms: uoms,
                DefaultUom: defaultUom,
                RateOptions: rateOptions,
                DefaultRate: defaultRate,
                DefaultSaleType: defaultSaleType,
                Notes: notes,
                // The HS_UOM lookup only reaches PRAL when the company has a
                // token; an empty list then means FBR genuinely has no UOM
                // restriction for this code (common for many codes), NOT a
                // failure. Without a token the lookup never ran.
                UomLookupRan: uoms.Count > 0 || !string.IsNullOrEmpty(company?.FbrToken),
                SaleTypes: TaxScenarios.All.Select(s => s.SaleType).Distinct().ToList()
            );
        }
    }
}
