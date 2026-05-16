using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
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

        // Cache keys are scoped per company because the FBR token is
        // per-company and PRAL bills the call. TTL is process lifetime —
        // a redeploy invalidates everything, which matches our weekly
        // deploy cadence.
        private static readonly ConcurrentDictionary<string, List<FbrUOMDto>> _hsUomCache = new();
        private static readonly ConcurrentDictionary<string, List<FbrSaleTypeRateDto>> _saleTypeRateCache = new();

        // FBR's HS_UOM endpoint requires an annexure id. 3 = "Sales of goods"
        // which covers >99 % of our use cases. Services / 6th-schedule items
        // would use 5/7 but we don't sell those today.
        private const int DefaultAnnexureId = 3;

        // FBR's SaleTypeToRate endpoint requires a transaction-type id.
        // 18 = "Goods sale" (the only one Hakimi uses). Reserved for future
        // override when other sectors come online (services, exports).
        private const int DefaultTransactionTypeId = 18;

        public TaxMappingEngine(IFbrService fbr, AppDbContext db)
        {
            _fbr = fbr;
            _db = db;
        }

        // ─── HS_UOM ────────────────────────────────────────────────

        public async Task<List<FbrUOMDto>> GetValidUomsForHsCodeAsync(int companyId, string hsCode)
        {
            if (string.IsNullOrWhiteSpace(hsCode)) return new();

            var key = $"{companyId}:{hsCode.Trim()}";
            if (_hsUomCache.TryGetValue(key, out var cached)) return cached;

            var fresh = await _fbr.GetHSCodeUOMAsync(companyId, hsCode.Trim(), DefaultAnnexureId);
            if (fresh != null && fresh.Count > 0)
                _hsUomCache.TryAdd(key, fresh);
            return fresh ?? new();
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
            var key = $"{companyId}:{DefaultTransactionTypeId}:{province}:{dateStr}";
            if (_saleTypeRateCache.TryGetValue(key, out var cached)) return cached;

            var fresh = await _fbr.GetSaleTypeRatesAsync(
                companyId, dateStr, DefaultTransactionTypeId, province);
            if (fresh != null && fresh.Count > 0)
                _saleTypeRateCache.TryAdd(key, fresh);
            return fresh ?? new();
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

            // (c) Rate ≠ 18 % requires SRO references (FBR 0077/0078).
            if (resolved.Rate != 18m
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
                Notes: notes
            );
        }
    }
}
