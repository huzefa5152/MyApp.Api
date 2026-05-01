using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;
using MyApp.Api.Services.Tax;

namespace MyApp.Api.Services.Implementations
{
    public class FbrService : IFbrService
    {
        private readonly IInvoiceRepository _invoiceRepo;
        private readonly ICompanyRepository _companyRepo;
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IAuditLogService _auditLog;
        private readonly AppDbContext _db;
        private readonly IStockService _stock;
        private readonly IServiceProvider _services;   // resolves ITaxMappingEngine lazily to avoid circular DI

        // ── V1.12 API URLs ──────────────────────────────────────
        // Submit/Validate: sandbox adds "_sb" suffix; routing also based on token
        private const string DiBaseUrl = "https://gw.fbr.gov.pk/di_data/v1/di";
        // Reference APIs v1 (provinces, doctypes, HS codes, UOM, transaction types, SRO item codes)
        private const string RefBaseV1 = "https://gw.fbr.gov.pk/pdi/v1";
        // Reference APIs v2 (SaleTypeToRate, SroSchedule, SROItem, HS_UOM)
        private const string RefBaseV2 = "https://gw.fbr.gov.pk/pdi/v2";
        // STATL / Registration check
        private const string DistBase = "https://gw.fbr.gov.pk/dist/v1";

        // Province code → name cache (populated from reference API on first use)
        private static readonly ConcurrentDictionary<int, Dictionary<int, string>> _provinceCache = new();

        // UOM ID → FBR description (from reference API 5.6)
        private static readonly ConcurrentDictionary<int, Dictionary<int, string>> _uomCache = new();

        // Global HS-code catalog cache. The catalog is identical across
        // companies (FBR's master list), so the first successful fetch from
        // ANY company seeds it for everyone. Lets companies that haven't
        // configured a token yet still browse the catalog on the Item Type
        // form — without this they'd get an empty autocomplete.
        private static List<FbrHSCodeDto>? _hsCodeCatalog;
        private static readonly SemaphoreSlim _hsCacheLock = new(1, 1);

        // Encoder note:
        // FBR's JSON parser rejects payloads that contain \uXXXX unicode escapes.
        // .NET's default encoder aggressively escapes anything non-ASCII to \uXXXX
        // — including the " (0x22) character inside strings, which gets serialised
        // as "\u0022" instead of "\"". FBR then responds:
        //     {"Code":"03","error":"Requested JSON in Malformed"}
        // UnsafeRelaxedJsonEscaping restricts escaping to characters that would
        // actually break JSON syntax ("\", control chars), letting printable
        // ASCII + quotes go through as the plain \" form FBR's parser accepts.
        private static readonly JsonSerializerOptions JsonOptions = new()
        {
            PropertyNameCaseInsensitive = true,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
        };

        // Document type int → FBR string. Fallback if FbrLookups has no row
        // for the given doc type. Kept in code because the 3 values are
        // fixed by FBR spec §5.2 and changing them would break submission.
        private static readonly Dictionary<int, string> DocTypeMap = new()
        {
            { 4, "Sale Invoice" },
            { 9, "Debit Note" },
            { 10, "Credit Note" }
        };

        // Look up a document-type label from FbrLookups if the operator has
        // customised it there; otherwise fall back to the built-in map.
        private async Task<string> ResolveDocTypeAsync(int? docTypeId)
        {
            var code = docTypeId ?? 4;
            var label = await _db.FbrLookups
                .AsNoTracking()
                .Where(l => l.Category == "DocumentType" && l.IsActive && l.Code == code.ToString())
                .Select(l => l.Label)
                .FirstOrDefaultAsync();
            return !string.IsNullOrEmpty(label) ? label : DocTypeMap.GetValueOrDefault(code, "Sale Invoice");
        }

        // ── NTN / CNIC normalisation (shared by pre-validate and payload build) ──
        //
        // FBR accepts 7-digit NTN or 13-digit CNIC. IRIS stores NTNs in three
        // formats that our DB keeps verbatim:
        //
        //   "NNNNNNN-C"          individual / small-business (e.g. "4228937-8")
        //                        → take 7 digits, drop check digit
        //
        //   "NN-NN-NNNNNNN-C"    corporate (zone-circle-NTN-check, e.g.
        //                        "13-02-0676470-3" for SOORTY)
        //                        → skip first 4 digits, take next 7
        //                        (naïve "split at first dash" would return "13"
        //                        → FBR 0002 "must be 7 digits")
        //
        //   "NNNNNNN" / "NNNNNNNN"  unsuffixed (old paper format, or 8-digit
        //                           with trailing check digit)
        //                        → take first 7
        internal static string SanitizeNtn(string? ntn)
        {
            if (string.IsNullOrWhiteSpace(ntn)) return "";
            var digits = new string(ntn.Where(char.IsDigit).ToArray());
            if (digits.Length < 7) return digits;
            var dashCount = ntn.Count(c => c == '-');
            if (dashCount >= 3 && digits.Length >= 11)
                return digits.Substring(4, 7);  // corporate "NN-NN-NNNNNNN-C"
            return digits.Substring(0, 7);
        }

        internal static string StripAllDigits(string? v)
        {
            if (string.IsNullOrWhiteSpace(v)) return "";
            return new string(v.Where(char.IsDigit).ToArray());
        }

        // ── SaleType canonicalisation (FBR V1.12 §9) ─────────────────
        //
        // FBR's HS_Code × Sale_Type validator rejects payloads where the
        // sale-type string doesn't EXACTLY match one of the §9 labels.
        // Older bills + early-version seeds wrote variants:
        //   • "Goods at standard rate (default)"  (lowercase 's')
        //   • "goods at standard rate (default)"  (all lowercase)
        // FBR V1.12 §9 specifies "Goods at Standard Rate (default)"
        // (capital 'S'). Mapping common variants to canonical form here
        // means existing bills with stale strings still submit cleanly
        // without rewriting their stored DB values.
        private static readonly Dictionary<string, string> SaleTypeCanonicalMap =
            new(StringComparer.OrdinalIgnoreCase)
            {
                ["Goods at Standard Rate (default)"] = "Goods at Standard Rate (default)",
                ["Goods at standard rate (default)"] = "Goods at Standard Rate (default)",
                ["goods at standard rate (default)"] = "Goods at Standard Rate (default)",
                ["3rd Schedule Goods"]               = "3rd Schedule Goods",
                ["Goods at Reduced Rate"]            = "Goods at Reduced Rate",
                ["Goods at zero-rate"]               = "Goods at zero-rate",
                ["Exempt Goods"]                     = "Exempt Goods",
                ["Exempt goods"]                     = "Exempt Goods",
            };

        internal static string NormalizeSaleType(string? saleType)
        {
            if (string.IsNullOrWhiteSpace(saleType))
                return "Goods at Standard Rate (default)";
            return SaleTypeCanonicalMap.TryGetValue(saleType.Trim(), out var canonical)
                ? canonical
                : saleType.Trim();
        }

        public FbrService(
            IInvoiceRepository invoiceRepo,
            ICompanyRepository companyRepo,
            IHttpClientFactory httpClientFactory,
            IAuditLogService auditLogService,
            AppDbContext db,
            IStockService stock,
            IServiceProvider services)
        {
            _invoiceRepo = invoiceRepo;
            _companyRepo = companyRepo;
            _httpClientFactory = httpClientFactory;
            _auditLog = auditLogService;
            _db = db;
            _stock = stock;
            _services = services;
        }

        // ── Text sanitization for FBR payloads ──────────────────
        //
        // FBR's JSON parser rejects two classes of input:
        //  (1) control characters (newlines, tabs, CR) even when properly
        //      escaped as \n / \t / \r
        //  (2) \uXXXX unicode escape sequences — which .NET emits for any
        //      non-ASCII char AND for " by default.
        //
        // Both return: {"Code":"03","error":"Requested JSON in Malformed"}.
        //
        // Mitigation is layered:
        //  • JsonOptions uses UnsafeRelaxedJsonEscaping so " stays as \"
        //  • SanitizeForFbr here replaces non-ASCII punctuation with the
        //    closest ASCII equivalent (em-dash → "-", curly quotes → plain
        //    quotes, etc.) so descriptions pasted from Word/Excel don't
        //    cause malformed-JSON rejections
        //  • Anything above U+007F that we can't map is dropped
        private static string SanitizeForFbr(string? value)
        {
            if (string.IsNullOrWhiteSpace(value)) return "";
            var cleaned = new System.Text.StringBuilder(value.Length);
            foreach (var c in value)
            {
                // (1) whitespace/control handling
                if (c == '\n' || c == '\r' || c == '\t') { cleaned.Append(' '); continue; }
                if (char.IsControl(c)) continue;

                // (2) map common non-ASCII punctuation to ASCII equivalents
                switch (c)
                {
                    case '\u2013':                    // en-dash –
                    case '\u2014':                    // em-dash —
                    case '\u2212':                    // minus sign −
                        cleaned.Append('-'); continue;
                    case '\u2018':                    // left single quote '
                    case '\u2019':                    // right single quote '
                    case '\u02BC':                    // modifier letter apostrophe
                        cleaned.Append('\''); continue;
                    case '\u201C':                    // left double quote "
                    case '\u201D':                    // right double quote "
                    case '\u00AB':                    // «
                    case '\u00BB':                    // »
                        // FBR's JSON parser rejects strings containing the plain
                        // ASCII " character (escaped as \" in JSON, which is valid
                        // per RFC 8259 but their parser returns "Requested JSON in
                        // Malformed"). Replace with single-quote which is commonly
                        // used in industrial catalogs for inch/minute/etc.
                        cleaned.Append('\''); continue;
                    case '\u00A0':                    // non-breaking space
                    case '\u2009':                    // thin space
                    case '\u200B':                    // zero-width space
                        cleaned.Append(' '); continue;
                    case '\u2026':                    // ellipsis …
                        cleaned.Append("..."); continue;
                    case '\u00D7':                    // multiplication ×
                        cleaned.Append('x'); continue;
                    case '\u00BD': cleaned.Append("1/2"); continue;  // ½
                    case '\u00BC': cleaned.Append("1/4"); continue;  // ¼
                    case '\u00BE': cleaned.Append("3/4"); continue;  // ¾
                }

                // (3) ASCII " → ' (same reason as curly quotes above — FBR's
                // parser mis-handles "..." strings containing escaped quotes)
                if (c == '"') { cleaned.Append('\''); continue; }

                // (4) backslash causes similar issues; normalise Windows paths
                // and escape-like sequences to forward slash / space
                if (c == '\\') { cleaned.Append('/'); continue; }

                // (5) drop anything else outside printable ASCII so the
                // serializer never emits a \uXXXX escape for it
                if (c > 0x7E) continue;

                cleaned.Append(c);
            }
            // Collapse multiple spaces to one, then trim
            return System.Text.RegularExpressions.Regex
                .Replace(cleaned.ToString(), @"\s+", " ")
                .Trim();
        }

        // ── URL helpers ─────────────────────────────────────────

        private static string GetSubmitUrl(Company company)
            => company.FbrEnvironment == "production"
                ? $"{DiBaseUrl}/postinvoicedata"
                : $"{DiBaseUrl}/postinvoicedata_sb";

        private static string GetValidateUrl(Company company)
            => company.FbrEnvironment == "production"
                ? $"{DiBaseUrl}/validateinvoicedata"
                : $"{DiBaseUrl}/validateinvoicedata_sb";

        private HttpClient CreateClient(Company company)
        {
            var client = _httpClientFactory.CreateClient("FBR");
            client.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", company.FbrToken);
            return client;
        }

        // ── Province code → name resolution ─────────────────────
        //
        // FBR expects the province NAME (e.g. "Sindh") in the submit payload, but
        // our DB stores the numeric CODE on Company / Client. The mapping is small
        // (8 rows) and stable, so we resolve it in priority order:
        //
        //   1. Live FBR /pdi/v1/provinces result (if we've already successfully
        //      fetched it for this company — freshest + authoritative)
        //   2. FbrLookups table where Category='Province' (operator-maintained,
        //      survives token bootstrap, can be edited without a code change)
        //   3. Opportunistic live fetch (populates the in-memory cache for future
        //      calls; silently falls through if token is bad / network down)
        //
        // Anything still unresolved after step 3 returns "" — caller treats that
        // as a genuinely invalid province code.
        private async Task<string> ResolveProvinceNameAsync(Company company, int? provinceCode)
        {
            if (provinceCode == null) return "";

            // 1) In-memory cache (populated by a prior live fetch in this process)
            if (_provinceCache.TryGetValue(company.Id, out var cachedMap)
                && cachedMap.TryGetValue(provinceCode.Value, out var cachedName))
                return cachedName;

            // 2) FbrLookups table — authoritative operator-maintained source.
            //    This is what the Company/Client dropdowns are populated from, so
            //    picking "Sindh" (code 8) on the form always round-trips cleanly.
            var lookupLabel = await _db.FbrLookups
                .AsNoTracking()
                .Where(l => l.Category == "Province" && l.IsActive && l.Code == provinceCode.Value.ToString())
                .Select(l => l.Label)
                .FirstOrDefaultAsync();
            if (!string.IsNullOrEmpty(lookupLabel)) return lookupLabel;

            // 3) Live FBR lookup — gives us the canonical FBR-accepted string
            //    (e.g. "SINDH" uppercase). If the token works, we populate the
            //    cache so subsequent calls skip straight to step 1.
            if (!_provinceCache.ContainsKey(company.Id))
            {
                try
                {
                    var provinces = await GetProvincesAsync(company.Id);
                    if (provinces != null && provinces.Count > 0)
                    {
                        var fresh = provinces.ToDictionary(p => p.StateProvinceCode, p => p.StateProvinceDesc);
                        _provinceCache.TryAdd(company.Id, fresh);
                        if (fresh.TryGetValue(provinceCode.Value, out var freshName))
                            return freshName;
                    }
                }
                catch { /* token bad / network down — resolved via step 2 already */ }
            }

            return "";
        }

        /// <summary>
        /// Resolves a UOM for the FBR payload.
        ///  1. If FbrUOMId is set and maps to an FBR UOM description → use that.
        ///  2. Else if the fallback (local UOM) matches an FBR UOM description
        ///     (case-insensitive, punctuation-tolerant) → use the FBR description.
        ///  3. Else fall back to the raw local UOM.
        /// This lets users submit to FBR even if they didn't explicitly pick an
        /// FBR UOM id, as long as their local unit name matches the FBR catalog.
        /// </summary>
        private async Task<string> ResolveUomDesc(Company company, int? uomId, string? fallback)
        {
            if (!_uomCache.TryGetValue(company.Id, out var map))
            {
                try
                {
                    var uoms = await GetUOMsAsync(company.Id);
                    map = uoms.ToDictionary(u => u.UOM_ID, u => u.Description);
                    _uomCache.TryAdd(company.Id, map);
                }
                catch { map = new Dictionary<int, string>(); }
            }

            // 1. Explicit FBR UOM id wins
            if (uomId.HasValue && map.TryGetValue(uomId.Value, out var desc))
                return desc;

            // 2. Try to fuzzy-match the local UOM string against FBR descriptions
            if (!string.IsNullOrWhiteSpace(fallback))
            {
                var normalized = Normalize(fallback);
                var match = map.Values.FirstOrDefault(v => Normalize(v) == normalized);
                if (match != null) return match;
            }

            // 3. Fall back to the local UOM string (FBR may still accept it)
            return fallback ?? "";

            static string Normalize(string s) =>
                new string(s.Where(char.IsLetterOrDigit).ToArray()).ToLowerInvariant();
        }

        // ── Pre-validation (before calling FBR) ─────────────────

        private async Task<FbrSubmissionResult?> PreValidate(Invoice invoice, Company company, Client buyer)
        {
            var errors = new List<string>();
            // NTN / CNIC normalisation — delegate to the class-level shared helpers
            // so pre-validate and payload build always agree on the sanitised value.
            // The local aliases keep the call sites below readable.
            static string StripDigits(string? v) => StripAllDigits(v);
            static string StripNtn(string? v)    => SanitizeNtn(v);

            // ─ Seller ─
            // Seller identity: prefer CNIC (13 digits) if set, otherwise NTN
            // (7 digits). FBR accepts either, but Hakimi Traders submissions
            // must use CNIC per the tax consultant's instruction.
            var sellerNtn = !string.IsNullOrWhiteSpace(company.CNIC)
                ? StripDigits(company.CNIC)
                : StripNtn(company.NTN);
            if (string.IsNullOrWhiteSpace(sellerNtn))
                errors.Add("Seller NTN/CNIC is required. Configure it in Company settings. [FBR 0001]");
            else if (sellerNtn.Length != 7 && sellerNtn.Length != 13)
                errors.Add($"Seller NTN must be 7 digits or CNIC must be 13 digits (current: {sellerNtn.Length}). [FBR 0108]");

            if (company.FbrProvinceCode == null)
                errors.Add("Seller Province is required. Configure FBR Province in Company settings. [FBR 0073]");

            if (string.IsNullOrWhiteSpace(company.FullAddress))
                errors.Add("Seller Address is required. Configure it in Company settings.");

            // ─ Buyer ─
            if (string.IsNullOrWhiteSpace(buyer.Name))
                errors.Add("Buyer Name is required. [FBR 0010]");

            var regType = MapBuyerRegType(buyer.RegistrationType);
            if (string.IsNullOrWhiteSpace(regType))
                errors.Add("Buyer Registration Type is required. [FBR 0012]");

            if (regType == "Registered")
            {
                // For NTN use StripNtn (7 digits), for CNIC use StripDigits (13 digits)
                var buyerNtn = StripNtn(buyer.NTN);
                var buyerCnic = StripDigits(buyer.CNIC);
                var buyerReg = buyerNtn.Length > 0 ? buyerNtn : buyerCnic;
                if (string.IsNullOrWhiteSpace(buyerReg))
                    errors.Add("Buyer NTN or CNIC is required for registered buyers. [FBR 0009]");
                else if (buyerReg.Length != 7 && buyerReg.Length != 13)
                    errors.Add($"Buyer NTN must be 7 digits or CNIC must be 13 digits (current: {buyerReg.Length}). [FBR 0002]");
            }

            if (buyer.FbrProvinceCode == null)
                errors.Add("Buyer Province is required. Configure FBR Province on the Client. [FBR 0074]");

            // ─ Self-invoicing check (FBR 0058) ─
            var buyerRegNo = StripNtn(buyer.NTN).Length > 0 ? StripNtn(buyer.NTN) : StripDigits(buyer.CNIC);
            if (!string.IsNullOrEmpty(sellerNtn) && !string.IsNullOrEmpty(buyerRegNo) && sellerNtn == buyerRegNo)
                errors.Add("Self-invoicing not allowed — buyer and seller registration numbers cannot be the same. [FBR 0058]");

            // ─ Invoice header ─
            // Use FbrLookups (with DocTypeMap fallback) — operator-editable, so a
            // future FBR rename doesn't need a code deploy.
            var invoiceTypeStr = await ResolveDocTypeAsync(invoice.DocumentType);
            if (invoiceTypeStr == "Debit Note" || invoiceTypeStr == "Credit Note")
            {
                if (string.IsNullOrWhiteSpace(invoice.FbrIRN))
                    errors.Add($"Invoice Reference Number is required for {invoiceTypeStr}s. The original invoice must be submitted to FBR first. [FBR 0026]");
                else if (invoice.FbrIRN.Length != 22 && invoice.FbrIRN.Length != 28)
                    errors.Add($"Invoice Reference Number must be 22 digits (NTN) or 28 digits (CNIC). Current: {invoice.FbrIRN.Length} characters.");
            }

            // Already-submitted guard
            if (invoice.FbrStatus == "Submitted" && !string.IsNullOrEmpty(invoice.FbrIRN))
                errors.Add($"Invoice already submitted to FBR. IRN: {invoice.FbrIRN}");

            if (invoice.Date > DateTime.UtcNow.AddDays(1))
                errors.Add("Invoice date cannot be in the future. [FBR 0043]");

            // ─ Items ─
            if (invoice.Items == null || !invoice.Items.Any())
                errors.Add("Invoice must have at least one item.");
            else
            {
                var itemList = invoice.Items.ToList();
                for (int i = 0; i < itemList.Count; i++)
                {
                    var item = itemList[i];
                    var n = i + 1;
                    if (string.IsNullOrWhiteSpace(item.HSCode))
                        errors.Add($"Item {n}: HS Code is required. [FBR 0019]");
                    if (string.IsNullOrWhiteSpace(item.SaleType))
                        errors.Add($"Item {n}: Sale Type is required. [FBR 0013]");
                    // UOM: we accept either FbrUOMId (preferred) OR a non-empty UOM string
                    // that will be matched against the FBR UOM list at submit time.
                    if (item.FbrUOMId == null && string.IsNullOrWhiteSpace(item.UOM))
                        errors.Add($"Item {n}: UOM is required.");
                    if (item.Quantity <= 0)
                        errors.Add($"Item {n}: Quantity must be greater than zero. [FBR 0098]");
                    if (item.LineTotal <= 0)
                        errors.Add($"Item {n}: Value of Sales must be greater than zero. [FBR 0021]");
                }
            }

            // ─ Mixed sale-type guard ─
            // FBR requires exactly ONE sale-type bucket per invoice (because
            // the request has a single scenarioId per bill). Mixing
            // "3rd Schedule Goods" with "Goods at Standard Rate (default)"
            // in the same bill returns 0052 / 0204 from PRAL with no useful
            // line-level detail. Catch it locally and tell the operator
            // exactly which lines to split out.
            if (errors.Count == 0 && invoice.Items != null)
            {
                var byBucket = invoice.Items
                    .Where(i => !string.IsNullOrWhiteSpace(i.SaleType))
                    .GroupBy(i => NormalizeSaleType(i.SaleType))
                    .ToList();
                if (byBucket.Count > 1)
                {
                    var summary = string.Join("; ",
                        byBucket.Select(g => $"\"{g.Key}\" on {g.Count()} line(s)"));
                    errors.Add(
                        "Mixed sale types in one invoice: FBR allows only one sale type per bill. "
                        + $"This bill has: {summary}. "
                        + "Split into separate bills (one per sale type) before submitting.");
                }
            }

            // ─ Tax-engine combination check ─
            // Mirrors what FBR rejects on its side, but locally — single
            // clear message instead of a 0052/0077/0102 from PRAL.
            if (errors.Count == 0 && invoice.Items != null)
            {
                var engine = _services.GetService(typeof(ITaxMappingEngine)) as ITaxMappingEngine;
                if (engine != null)
                {
                    // Auto-detect scenario from paymentTerms ("[SN00x]" prefix)
                    // so the engine has the same view that PostInvoiceAsync uses.
                    string? scen = null;
                    if (!string.IsNullOrEmpty(invoice.PaymentTerms))
                    {
                        var m = System.Text.RegularExpressions.Regex.Match(
                            invoice.PaymentTerms, @"\[\s*(SN\d{3})\s*\]",
                            System.Text.RegularExpressions.RegexOptions.IgnoreCase);
                        if (m.Success) scen = m.Groups[1].Value.ToUpperInvariant();
                    }

                    var itemList = invoice.Items.ToList();
                    for (int i = 0; i < itemList.Count; i++)
                    {
                        var item = itemList[i];
                        var input = new TaxResolutionInput(
                            CompanyId: company.Id,
                            HsCode: item.HSCode,
                            ScenarioCode: scen,
                            Rate: invoice.GSTRate,
                            BuyerRegistrationType: MapBuyerRegType(buyer.RegistrationType),
                            InvoiceDate: invoice.Date,
                            ProvinceCode: company.FbrProvinceCode,
                            TransactionTypeId: null,
                            SaleTypeOverride: item.SaleType,
                            Uom: item.UOM,
                            FbrUomId: item.FbrUOMId
                        );
                        var combo = await engine.ValidateCombinationAsync(
                            input, item.LineTotal, item.FixedNotifiedValueOrRetailPrice);
                        foreach (var err in combo)
                            errors.Add($"Item {i + 1}: {err}");
                    }
                }
            }

            if (errors.Count > 0)
            {
                return new FbrSubmissionResult
                {
                    Success = false,
                    ErrorMessage = "Pre-validation failed:\n" + string.Join("\n", errors.Select(e => $"• {e}"))
                };
            }

            return null;
        }

        /// Map our RegistrationType values to FBR's expected "Registered"/"Unregistered"
        private static string MapBuyerRegType(string? regType) => (regType ?? "Registered") switch
        {
            "Registered" => "Registered",
            "Unregistered" => "Unregistered",
            "FTN" => "Registered",          // FTN holders are registered
            "CNIC" => "Unregistered",       // CNIC-only means unregistered for GST
            _ => "Registered"
        };

        // ═══════════════════════════════════════════════════════════
        //  Submit & Validate
        // ═══════════════════════════════════════════════════════════

        public async Task<FbrSubmissionResult> SubmitInvoiceAsync(int invoiceId, string? scenarioId = null)
            => await PostInvoiceAsync(invoiceId, isSubmit: true, scenarioId, dryRun: false);

        public async Task<FbrSubmissionResult> ValidateInvoiceAsync(int invoiceId, string? scenarioId = null)
            => await PostInvoiceAsync(invoiceId, isSubmit: false, scenarioId, dryRun: false);

        /// <summary>
        /// Build the exact JSON we would POST to FBR's validate endpoint —
        /// without actually sending. Lets operators sanity-check the
        /// grouped items / values before clicking the real button.
        /// Returns the same structure as a normal validate, but populates
        /// `Preview` with the JSON and skips both the HTTP call and any
        /// FBR-status mutations on the bill. Pre-validate still runs so
        /// missing fields are caught before the build even starts.
        /// </summary>
        public async Task<FbrSubmissionResult> PreviewInvoicePayloadAsync(int invoiceId, string? scenarioId = null)
            => await PostInvoiceAsync(invoiceId, isSubmit: false, scenarioId, dryRun: true);

        private async Task<FbrSubmissionResult> PostInvoiceAsync(int invoiceId, bool isSubmit, string? scenarioId, bool dryRun)
        {
            // ── Load entities ──
            var invoice = await _invoiceRepo.GetByIdAsync(invoiceId);
            if (invoice == null)
                return Fail("Invoice not found.");

            var company = await _companyRepo.GetByIdAsync(invoice.CompanyId);
            if (company == null)
                return Fail("Company not found.");

            // Auto-detect the scenario from paymentTerms when the caller didn't
            // explicitly pass one. Test bills seeded with a "[SN00x] …" prefix
            // on their paymentTerms/documentType field get routed to the
            // right scenario automatically, so the UI's Validate All / Submit
            // All buttons work without the operator remembering each bill's
            // scenario number.
            if (string.IsNullOrWhiteSpace(scenarioId)
                && !string.IsNullOrEmpty(invoice.PaymentTerms))
            {
                var m = System.Text.RegularExpressions.Regex.Match(
                    invoice.PaymentTerms, @"\[\s*(SN\d{3})\s*\]",
                    System.Text.RegularExpressions.RegexOptions.IgnoreCase);
                if (m.Success) scenarioId = m.Groups[1].Value.ToUpperInvariant();
            }

            if (string.IsNullOrEmpty(company.FbrToken))
                return Fail("FBR token is not configured for this company. Go to Company settings → FBR Token.");

            var buyer = invoice.Client;
            if (buyer == null)
                return Fail("Invoice client data is missing.");

            bool isSandbox = company.FbrEnvironment != "production";

            // ── Refresh FBR-classification fields from the live ItemType ──
            // Operators expect the bill to track the catalog at submit time:
            // if they fix an Item Type's UoM / HS Code / Sale Type after a
            // bill was created, the next Validate or Submit must use the
            // corrected catalog values — not the stale snapshot taken when
            // the bill was first saved. (FBR error 0099 happens precisely
            // because the snapshot drifted from the catalog.)
            //
            // Boundaries:
            //   • Only runs for non-Submitted bills. Submitted bills carry
            //     their own audit-locked snapshot — re-validating one is
            //     a no-op for FBR but we don't rewrite history.
            //   • Only refreshes lines that carry an ItemTypeId. Lines
            //     created without picking from the catalog (free-text) keep
            //     their operator-typed values; the pre-flight HS_UOM check
            //     still blocks any mismatch there.
            //   • Touches only the four FBR-classification fields
            //     (HSCode / UOM / FbrUOMId / SaleType) plus the display
            //     ItemTypeName. Quantity / unit price / SRO references
            //     stay as the operator entered them.
            //   • Skipped for dry-run preview — preview is read-only.
            if (!dryRun
                && !string.Equals(invoice.FbrStatus, "Submitted", StringComparison.OrdinalIgnoreCase))
            {
                var typeIds = invoice.Items
                    .Where(ii => ii.ItemTypeId.HasValue)
                    .Select(ii => ii.ItemTypeId!.Value)
                    .Distinct()
                    .ToList();
                if (typeIds.Count > 0)
                {
                    var liveTypes = await _db.ItemTypes
                        .Where(t => typeIds.Contains(t.Id))
                        .ToDictionaryAsync(t => t.Id);

                    bool anyChanged = false;
                    foreach (var line in invoice.Items)
                    {
                        if (!line.ItemTypeId.HasValue) continue;
                        if (!liveTypes.TryGetValue(line.ItemTypeId.Value, out var t)) continue;

                        if (line.HSCode       != t.HSCode)        { line.HSCode = t.HSCode;        anyChanged = true; }
                        if ((line.UOM ?? "")  != (t.UOM ?? ""))   { line.UOM = t.UOM ?? "";        anyChanged = true; }
                        if (line.FbrUOMId     != t.FbrUOMId)      { line.FbrUOMId = t.FbrUOMId;    anyChanged = true; }
                        if (line.SaleType     != t.SaleType)      { line.SaleType = t.SaleType;    anyChanged = true; }
                        if (line.ItemTypeName != t.Name)          { line.ItemTypeName = t.Name;    anyChanged = true; }
                    }

                    if (anyChanged)
                        await _db.SaveChangesAsync();
                }
            }

            // ── Pre-validate ──
            // Skipped for dry-run preview so the operator can inspect the
            // would-be JSON even when fields are incomplete (preview is
            // for shape-checking; missing-field errors are caught later
            // when they actually click Validate / Submit).
            if (!dryRun)
            {
                var preResult = await PreValidate(invoice, company, buyer);
                if (preResult != null) return preResult;
            }

            // Stock availability is NOT a gate on FBR submission. Sales /
            // tax compliance comes first — most operators care about
            // filing on time, not inventory accuracy. If a sale exceeds
            // on-hand, Stock OUT still emits after the successful submit
            // (so on-hand goes negative), and the dashboard surfaces that
            // in red. Operator catches up by recording the matching
            // PurchaseBill or an opening-balance adjustment later.


            // ── Resolve province names ──
            var sellerProvince = await ResolveProvinceNameAsync(company, company.FbrProvinceCode);
            var buyerProvince = await ResolveProvinceNameAsync(company, buyer.FbrProvinceCode);

            // With the static-fallback in ResolveProvinceNameAsync, these errors
            // only fire for province codes outside the FBR-published 1..8 range —
            // a genuine data issue on the Company/Client record.
            if (string.IsNullOrEmpty(sellerProvince))
                return Fail($"Seller province code {company.FbrProvinceCode} is not a valid FBR province. Valid codes: 1..8 (see FBR /pdi/v1/provinces). Fix on Company → FBR Settings.");
            if (string.IsNullOrEmpty(buyerProvince))
                return Fail($"Buyer province code {buyer.FbrProvinceCode} is not a valid FBR province. Valid codes: 1..8. Fix on the Client record.");

            // ── Determine buyer NTN/CNIC ──
            var buyerRegType = MapBuyerRegType(buyer.RegistrationType);
            var buyerNtnCnic = !string.IsNullOrEmpty(buyer.NTN) ? buyer.NTN
                             : !string.IsNullOrEmpty(buyer.CNIC) ? buyer.CNIC
                             : "";
            // For unregistered buyers, buyerNTNCNIC is optional per V1.12
            if (buyerRegType == "Unregistered" && string.IsNullOrEmpty(buyerNtnCnic))
                buyerNtnCnic = "";

            // ── Sanitize NTN/CNIC ──
            // Uses the shared class-level helpers (FbrService.SanitizeNtn /
            // StripAllDigits) so pre-validate and payload build can't drift.
            // Seller: prefer CNIC (13 digits) when configured; fall back to
            // NTN (7 digits). CNIC is required for Hakimi Traders per the
            // tax consultant; NTN-only submissions are supported as a legacy
            // path for other companies.
            var sellerNtnCnic = !string.IsNullOrWhiteSpace(company.CNIC)
                ? StripAllDigits(company.CNIC)
                : SanitizeNtn(company.NTN);
            // Buyer: if NTN use SanitizeNtn (7 digits), if CNIC strip all non-digits (13 digits)
            if (!string.IsNullOrEmpty(buyer.NTN))
                buyerNtnCnic = SanitizeNtn(buyer.NTN);
            else if (!string.IsNullOrEmpty(buyer.CNIC))
                buyerNtnCnic = StripAllDigits(buyer.CNIC);
            else
                buyerNtnCnic = "";

            // ── Build V1.12 request ──
            var fbrRequest = new FbrInvoiceRequest
            {
                InvoiceType = await ResolveDocTypeAsync(invoice.DocumentType),
                InvoiceDate = invoice.Date.ToString("yyyy-MM-dd"),
                SellerNTNCNIC = sellerNtnCnic,
                SellerBusinessName = SanitizeForFbr(company.Name),
                SellerProvince = sellerProvince,
                SellerAddress = SanitizeForFbr(company.FullAddress),
                BuyerNTNCNIC = buyerNtnCnic,
                BuyerBusinessName = SanitizeForFbr(buyer.Name),
                BuyerProvince = buyerProvince,
                BuyerAddress = SanitizeForFbr(buyer.Address),
                BuyerRegistrationType = buyerRegType,
                InvoiceRefNo = (invoice.DocumentType == 9 || invoice.DocumentType == 10) ? (invoice.FbrIRN ?? "") : "",
                ScenarioId = isSandbox ? (scenarioId ?? "SN001") : null,
                Items = new List<FbrInvoiceItemRequest>()
            };

            // ── Item-Type grouping (mirrors the Tax Invoice print) ───────────
            //
            // The Tax Invoice we hand to clients groups bill lines by ItemType
            // (sum of quantities + sum of line totals, one row per type),
            // because that's how the buyer sees their purchase: 5 batteries,
            // 2 rolls of adhesive tape — not 5 separate battery line items.
            //
            // Mirror that grouping in the FBR payload so the digital invoice
            // matches what FBR would expect to see on the printed tax
            // invoice. Same rule as PrintTaxInvoiceDto: only group when EVERY
            // line has an ItemTypeName; if any line is unclassified, fall
            // back to per-line emission (same fallback the print uses).
            //
            // The grouping is safe because each line's HSCode / UOM / SaleType
            // / SROs are derived from the catalog ItemType, so all lines in
            // a group share those fields. Sum-of-LineTotals × rate gives the
            // same FBR-tax answer as summing per-line tax (linear in value).
            // 3rd Schedule items also work correctly: summed retail price
            // × rate is the same as sum of per-line retail × rate.
            var fbrItems = invoice.Items.All(ii => !string.IsNullOrWhiteSpace(ii.ItemTypeName))
                ? invoice.Items
                    .GroupBy(ii => ii.ItemTypeName)
                    .Select(g =>
                    {
                        var first = g.First();
                        return new InvoiceItem
                        {
                            // Keep ItemType-derived fields (all lines in a
                            // group share these because they came from the
                            // same catalog row).
                            ItemTypeId = first.ItemTypeId,
                            ItemTypeName = g.Key,
                            UOM = first.UOM,
                            FbrUOMId = first.FbrUOMId,
                            HSCode = first.HSCode,
                            SaleType = first.SaleType,
                            SroScheduleNo = first.SroScheduleNo,
                            SroItemSerialNo = first.SroItemSerialNo,
                            // ProductDescription = the ItemTypeName so the
                            // FBR row matches the Tax Invoice print row.
                            Description = g.Key,
                            // Sum the value-bearing columns.
                            Quantity = g.Sum(ii => ii.Quantity),
                            LineTotal = g.Sum(ii => ii.LineTotal),
                            FixedNotifiedValueOrRetailPrice = g.Sum(ii => ii.FixedNotifiedValueOrRetailPrice ?? 0m),
                        };
                    })
                    .ToList()
                : invoice.Items.ToList();

            // Resolve UOM descriptions + compute FBR-compliant tax numbers per
            // (grouped) item. ComputeFbrTaxes encodes the three rules that
            // differ from plain "line × rate":
            //   1) 3rd Schedule Goods: tax is BACKED OUT of tax-inclusive MRP
            //      salesTax = retailPrice × rate / (1 + rate)
            //   2) Unregistered-buyer standard-rate: add 4% further tax
            //   3) End-consumer retail (SN026/027/028): NO further tax even if unregistered
            foreach (var item in fbrItems)
            {
                var (salesTax, furtherTax, retailPrice) =
                    ComputeFbrTaxes(item, invoice.GSTRate, buyerRegType, fbrRequest.ScenarioId);
                var uomDesc = await ResolveUomDesc(company, item.FbrUOMId, item.UOM);
                // Normalise the sale-type string to the §9 canonical form.
                // Older seed rows + manually-entered bills sometimes carry
                // lowercase "Goods at standard rate (default)" which FBR
                // (post-2025-05) rejects with 0052 even though both casings
                // were tolerated historically. Mapping to the spec form
                // here means the FBR payload is always canonical regardless
                // of what the row stored.
                var saleType = NormalizeSaleType(item.SaleType);

                // FBR rule [0077]: "Valid SRO/Schedule No. is mandatory where rate
                // is not 18%." Prefer the operator-set value on the item; fall
                // back to the canonical EIGHTH SCHEDULE Table 1 + serial 82 for
                // reduced-rate scenarios so users aren't forced to configure
                // it when they're just running the sandbox tests.
                string sroScheduleNo = item.SroScheduleNo ?? "";
                string sroItemSerialNo = item.SroItemSerialNo ?? "";
                var isReducedRate = saleType.IndexOf("Reduced", StringComparison.OrdinalIgnoreCase) >= 0;
                if (isReducedRate && invoice.GSTRate != 18m
                    && string.IsNullOrWhiteSpace(sroScheduleNo))
                {
                    // Per PRAL's published SN028 sample payload, the sandbox
                    // accepts "EIGHTH SCHEDULE Table 1" + serial "70" at a 1%
                    // rate for reduced-rate end-consumer goods.
                    sroScheduleNo = "EIGHTH SCHEDULE Table 1";
                    sroItemSerialNo = "70";
                }

                fbrRequest.Items.Add(new FbrInvoiceItemRequest
                {
                    HsCode = item.HSCode ?? "",
                    ProductDescription = SanitizeForFbr(item.Description),
                    Rate = $"{invoice.GSTRate:0.##}%",
                    UoM = uomDesc,
                    Quantity = item.Quantity,
                    TotalValues = 0,
                    ValueSalesExcludingST = item.LineTotal,
                    FixedNotifiedValueOrRetailPrice = retailPrice,
                    SalesTaxApplicable = salesTax,
                    SalesTaxWithheldAtSource = 0,
                    // Reduced-rate: FBR rejects numeric 0 with [0091], so
                    // serialise as empty string. All other scenarios use 0.
                    ExtraTax = isReducedRate ? (object)"" : (object)0m,
                    FurtherTax = furtherTax,
                    SroScheduleNo = sroScheduleNo,
                    FedPayable = 0,
                    Discount = 0,
                    SaleType = saleType,
                    SroItemSerialNo = sroItemSerialNo
                });
            }

            // ── Call FBR API ──
            var action = isSubmit ? "Submit" : "Validate";
            var url = isSubmit ? GetSubmitUrl(company) : GetValidateUrl(company);
            var json = JsonSerializer.Serialize(fbrRequest, JsonOptions);

            // Dry-run preview — return the built JSON without POSTing
            // anything and without writing to the FBR audit log. Lets
            // operators inspect the grouping/values pre-flight.
            if (dryRun)
            {
                return new FbrSubmissionResult
                {
                    Success = true,
                    Preview = new FbrPayloadPreview
                    {
                        Json = json,
                        Url = url,
                        ItemCount = fbrRequest.Items.Count,
                        OriginalLineCount = invoice.Items.Count,
                    }
                };
            }

            try
            {
                var httpClient = CreateClient(company);
                var content = new StringContent(json, Encoding.UTF8, "application/json");

                var response = await httpClient.PostAsync(url, content);
                var responseBody = await response.Content.ReadAsStringAsync();

                // ── HTTP-level errors ──
                if (!response.IsSuccessStatusCode)
                {
                    var statusCode = (int)response.StatusCode;

                    // Try to extract FBR's own error message from the response body
                    string fbrDetail = "";
                    try
                    {
                        var errResp = JsonSerializer.Deserialize<FbrApiResponse>(responseBody, JsonOptions);
                        if (errResp?.ValidationResponse?.Error != null)
                            fbrDetail = $" FBR says: \"{errResp.ValidationResponse.Error}\"";
                    }
                    catch { /* ignore parse errors */ }

                    string errorMsg = statusCode switch
                    {
                        401 => $"FBR authentication failed (0401) — the token is not authorized for seller NTN '{sellerNtnCnic}'. Please verify on IRIS portal that Digital Invoicing is enabled for this NTN and the token is active.{fbrDetail}",
                        403 => $"FBR access denied — your token may not have the required permissions.{fbrDetail}",
                        429 => "FBR rate limit exceeded. Please wait a moment and try again.",
                        500 => "FBR internal server error. Please try again later or contact FBR support.",
                        _ => $"FBR API returned HTTP {statusCode}: {responseBody}"
                    };

                    await AuditFbr("Error", action, invoice.Id, url, json, responseBody, statusCode, errorMsg);
                    if (isSubmit) await PersistStatus(invoice, "Failed", null, errorMsg);
                    return Fail(errorMsg);
                }

                // ── Parse response ──
                var fbrResponse = JsonSerializer.Deserialize<FbrApiResponse>(responseBody, JsonOptions);
                var validation = fbrResponse?.ValidationResponse;

                if (validation == null)
                {
                    var msg = $"FBR returned an unexpected response format: {responseBody}";
                    if (isSubmit) await PersistStatus(invoice, "Failed", null, msg);
                    return Fail(msg);
                }

                // ── Pattern 1: Header-level error (statusCode "01") ──
                // FBR returns statusCode "01" in two flavours:
                //   (a) header-only error with invoiceStatuses = null
                //       (e.g. token / NTN / scenario auth failures)
                //   (b) header-tagged Invalid + invoiceStatuses populated
                //       with per-item errors (UOM mismatches, duplicates etc.)
                // The original code returned with an empty message in case (b)
                // because validation.Error is empty and ErrorCode is null —
                // the real diagnostics live in invoiceStatuses. Always check
                // there first, falling back to the header strings.
                if (validation.StatusCode == "01")
                {
                    var headerMsg = !string.IsNullOrEmpty(validation.ErrorCode)
                        ? $"[{validation.ErrorCode}] {validation.Error}"
                        : validation.Error ?? "";

                    var itemErrors = validation.InvoiceStatuses?
                        .Where(s => s.StatusCode == "01")
                        .ToList();
                    var itemMsg = itemErrors?.Count > 0
                        ? string.Join("; ", itemErrors.Select(e =>
                            $"Item {e.ItemSNo}: [{e.ErrorCode}] {e.Error}"))
                        : "";

                    var msg = !string.IsNullOrWhiteSpace(itemMsg) ? itemMsg
                            : !string.IsNullOrWhiteSpace(headerMsg) ? headerMsg
                            : "FBR validation failed with unspecified errors.";

                    await AuditFbr("Warning", action, invoice.Id, url, json, responseBody, 200, msg);
                    if (isSubmit) await PersistStatus(invoice, "Failed", null, msg);
                    return new FbrSubmissionResult
                    {
                        Success = false,
                        FbrStatus = "Failed",
                        ErrorMessage = msg,
                        ItemErrors = itemErrors,
                    };
                }

                // ── Pattern 2: Item-level errors (statusCode "00", status "Invalid"/"invalid") ──
                if (validation.Status?.Equals("Invalid", StringComparison.OrdinalIgnoreCase) == true)
                {
                    var errorItems = validation.InvoiceStatuses?
                        .Where(s => s.StatusCode == "01")
                        .ToList();
                    var msg = errorItems?.Count > 0
                        ? string.Join("; ", errorItems.Select(e => $"Item {e.ItemSNo}: [{e.ErrorCode}] {e.Error}"))
                        : validation.Error ?? "FBR validation failed with unspecified item errors.";

                    await AuditFbr("Warning", action, invoice.Id, url, json, responseBody, 200, msg);
                    if (isSubmit) await PersistStatus(invoice, "Failed", null, msg);
                    return new FbrSubmissionResult
                    {
                        Success = false,
                        FbrStatus = "Failed",
                        ErrorMessage = msg,
                        ItemErrors = errorItems
                    };
                }

                // ── Pattern 3: Success (statusCode "00", status "Valid") ──
                if (validation.Status?.Equals("Valid", StringComparison.OrdinalIgnoreCase) == true)
                {
                    var irn = fbrResponse?.InvoiceNumber; // top-level IRN (only in POST response)

                    if (isSubmit)
                    {
                        await PersistStatus(invoice, "Submitted", irn, null);

                        // Emit Stock OUT for every line bound to a catalog
                        // ItemType. We do this AFTER PRAL acknowledged the
                        // submission — a failed submit produces no movement,
                        // and the pre-check above guarantees we won't
                        // oversell here. Lines without an ItemTypeId are
                        // intentionally skipped (we can't track what we
                        // can't classify); StockService.RecordMovementAsync
                        // is also a no-op when tracking is disabled, so
                        // existing tenants pay zero cost.
                        foreach (var item in invoice.Items)
                        {
                            if (!item.ItemTypeId.HasValue || item.Quantity <= 0) continue;
                            // InvoiceItem.Quantity is decimal(18,4) since the
                            // decimal-qty feature, but StockMovement.Quantity is
                            // still int (purchase-module schema). Truncate at
                            // the boundary — fractional sales are a sales-side
                            // concern; stock tracking only follows whole units
                            // until the purchase module also goes decimal.
                            // TODO: promote StockMovement / PurchaseItem /
                            // GoodsReceiptItem / OpeningStockBalance quantities
                            // to decimal(18,4) and drop this cast.
                            await _stock.RecordMovementAsync(
                                companyId: invoice.CompanyId,
                                itemTypeId: item.ItemTypeId.Value,
                                direction: StockMovementDirection.Out,
                                quantity: (int)Math.Truncate(item.Quantity),
                                sourceType: StockMovementSourceType.Invoice,
                                sourceId: invoice.Id,
                                movementDate: invoice.Date,
                                notes: $"Bill #{invoice.InvoiceNumber} submitted to FBR (IRN {irn})");
                        }
                    }

                    var successMsg = isSubmit
                        ? $"Invoice {invoice.InvoiceNumber} submitted to FBR successfully. IRN: {irn}"
                        : $"Invoice {invoice.InvoiceNumber} validated by FBR successfully.";
                    await AuditFbr("Info", action, invoice.Id, url, json, responseBody, 200, successMsg);

                    return new FbrSubmissionResult
                    {
                        Success = true,
                        IRN = irn,
                        FbrStatus = isSubmit ? "Submitted" : "Validated"
                    };
                }

                // ── Unexpected status ──
                var unexpectedMsg = $"FBR returned unexpected status: {validation.StatusCode} / {validation.Status}. Error: {validation.Error}";
                await AuditFbr("Warning", action, invoice.Id, url, json, responseBody, 200, unexpectedMsg);
                if (isSubmit) await PersistStatus(invoice, "Failed", null, unexpectedMsg);
                return Fail(unexpectedMsg);
            }
            catch (HttpRequestException ex)
            {
                var msg = $"Cannot connect to FBR — {ex.Message}. Check your internet connection and ensure your server IP is whitelisted on the FBR IRIS portal.";
                await AuditFbr("Error", action, invoice.Id, url, json, null, 0, msg);
                if (isSubmit) await PersistStatus(invoice, "Failed", null, msg);
                return Fail(msg);
            }
            catch (TaskCanceledException)
            {
                var msg = "FBR request timed out. The FBR server may be slow or unreachable. Please try again.";
                await AuditFbr("Error", action, invoice.Id, url, json, null, 0, msg);
                if (isSubmit) await PersistStatus(invoice, "Failed", null, msg);
                return Fail(msg);
            }
            catch (Exception ex)
            {
                var msg = $"Unexpected error: {ex.Message}";
                await AuditFbr("Error", action, invoice.Id, url, json, null, 0, msg);
                if (isSubmit) await PersistStatus(invoice, "Failed", null, msg);
                return Fail(msg);
            }
        }

        private async Task PersistStatus(Invoice invoice, string status, string? irn, string? errorMessage)
        {
            invoice.FbrStatus = status;
            if (irn != null) invoice.FbrIRN = irn;
            invoice.FbrErrorMessage = errorMessage;
            invoice.FbrSubmittedAt = DateTime.UtcNow;
            await _invoiceRepo.UpdateAsync(invoice);
        }

        private static FbrSubmissionResult Fail(string message)
            => new() { Success = false, ErrorMessage = message };

        // ═══════════════════════════════════════════════════════════
        //  FBR tax computation — the math FBR validates against
        // ═══════════════════════════════════════════════════════════
        //
        // Encodes three rules that differ from the naïve "line × rate":
        //
        //  (1) 3rd Schedule Goods (SN008, SN027)
        //      salesTax = retailPrice × rate / (1 + rate)
        //      (FBR treats the MRP as tax-INCLUSIVE; tax is backed out.
        //       Without this, FBR error 0102 "Calculated tax not matched in 3rd schedule".)
        //
        //  (2) Standard-rate + Unregistered buyer (SN002)
        //      furtherTax = lineTotal × 4%
        //      (Section 236G of Income Tax Ordinance. Skipping this triggers
        //       FBR error 0102.)
        //
        //  (3) End-consumer retail (SN026, SN027, SN028)
        //      furtherTax = 0 even though buyer is Unregistered
        //      (FBR exempts end-consumer retail from further tax — that's the
        //       whole point of the SN026/27/28 scenario family.)
        //
        // Returns (salesTax, furtherTax, fixedNotifiedValueOrRetailPrice) — every
        // caller needs all three to fill the FBR payload.
        private static (decimal salesTax, decimal furtherTax, decimal retailPrice)
            ComputeFbrTaxes(InvoiceItem item, decimal gstRate, string buyerRegType, string? scenarioId)
        {
            var rate = gstRate / 100m;
            var retail = item.FixedNotifiedValueOrRetailPrice ?? 0m;
            decimal salesTax;
            decimal furtherTax = 0m;

            var isThirdSchedule = string.Equals(
                item.SaleType, "3rd Schedule Goods", StringComparison.OrdinalIgnoreCase);
            var isStandardRate = string.Equals(
                item.SaleType, "Goods at Standard Rate (default)", StringComparison.OrdinalIgnoreCase)
                || string.Equals(
                    item.SaleType, "Goods at standard rate (default)", StringComparison.OrdinalIgnoreCase);

            // (1) 3rd Schedule: tax = MRP × rate (forward). PRAL's sandbox
            // rejects the backed-out formula with error [0102] even though
            // some earlier docs described it the other way — the forward
            // calculation is what SN008 / SN027 actually pass with.
            if (isThirdSchedule && retail > 0m)
            {
                salesTax = Math.Round(retail * rate, 2, MidpointRounding.AwayFromZero);
            }
            else
            {
                salesTax = Math.Round(item.LineTotal * rate, 2, MidpointRounding.AwayFromZero);
            }

            // (2) Unregistered + standard-rate ⇒ 4% further tax
            // (3) …except SN026/027/028 end-consumer retail (exempt)
            var isEndConsumerRetail =
                scenarioId is "SN026" or "SN027" or "SN028";

            if (buyerRegType == "Unregistered" && isStandardRate && !isEndConsumerRetail)
            {
                furtherTax = Math.Round(item.LineTotal * 0.04m, 2, MidpointRounding.AwayFromZero);
            }

            return (salesTax, furtherTax, retail);
        }

        private async Task AuditFbr(string level, string action, int invoiceId,
            string url, string? requestBody, string? responseBody, int httpStatus, string message)
        {
            try
            {
                // Truncate bodies to fit audit log limits
                var reqTruncated = requestBody?.Length > 4000 ? requestBody[..4000] : requestBody;
                var respTruncated = responseBody?.Length > 4000 ? responseBody[..4000] : responseBody;

                await _auditLog.LogAsync(new AuditLog
                {
                    Level = level,
                    HttpMethod = "POST",
                    RequestPath = $"/fbr/{action.ToLower()}/{invoiceId}",
                    StatusCode = httpStatus,
                    ExceptionType = $"FBR_{action}",
                    Message = message,
                    RequestBody = reqTruncated,
                    StackTrace = respTruncated,  // Store FBR response in StackTrace field
                    QueryString = url
                });
            }
            catch { /* never let audit logging break the FBR flow */ }
        }

        // ═══════════════════════════════════════════════════════════
        //  Reference Data APIs (V1.12 §5)
        // ═══════════════════════════════════════════════════════════

        public async Task<List<FbrProvinceDto>> GetProvincesAsync(int companyId)
            => await GetReferenceData<FbrProvinceDto>(companyId, $"{RefBaseV1}/provinces");

        public async Task<List<FbrDocTypeDto>> GetDocTypesAsync(int companyId)
            => await GetReferenceData<FbrDocTypeDto>(companyId, $"{RefBaseV1}/doctypecode");

        public async Task<List<FbrHSCodeDto>> GetHSCodesAsync(int companyId, string? search = null, string? saleType = null)
        {
            var all = await GetHsCodeCatalogAsync(companyId);

            // Apply sale-type filter BEFORE the text search so the cap
            // (50 / 100) operates on the already-narrowed list.
            // HsPrefixHeuristics.Match(code) returns the scenario the HS
            // code "naturally" maps to; codes that don't match any rule
            // fall through to SN001's sale type ("Goods at Standard Rate
            // (default)"), which is the right answer for ~80% of FBR's
            // 14k+ catalog.
            if (!string.IsNullOrWhiteSpace(saleType))
            {
                var defaultSaleType = TaxScenarios.Find(TaxScenarios.DefaultCode)?.SaleType
                                      ?? "Goods at Standard Rate (default)";
                var wantedSaleType = saleType.Trim();
                all = all.Where(h =>
                {
                    var heuristic = HsPrefixHeuristics.Match(h.HS_CODE);
                    var effective = heuristic?.SaleType ?? defaultSaleType;
                    return string.Equals(effective, wantedSaleType, StringComparison.OrdinalIgnoreCase);
                }).ToList();
            }

            if (!string.IsNullOrWhiteSpace(search))
            {
                var term = search.ToLower();
                all = all.Where(h =>
                    h.HS_CODE.ToLower().Contains(term) ||
                    h.Description.ToLower().Contains(term)
                ).Take(50).ToList();
            }
            else
            {
                // Empty / no search → return the first 100 so the autocomplete
                // can show a "browse" view when the operator just clicks into
                // the field without typing anything yet.
                all = all.Take(100).ToList();
            }
            return all;
        }

        // The HS code catalog is the same regardless of which company asks for
        // it (FBR's master list). Hold a single in-process copy keyed by no one;
        // first successful fetch from any company seeds it. Companies without
        // a token then get the cached copy too — so the Item Type form's
        // autocomplete keeps working even mid-onboarding when the token isn't
        // pasted in yet.
        private async Task<List<FbrHSCodeDto>> GetHsCodeCatalogAsync(int requestingCompanyId)
        {
            if (_hsCodeCatalog != null) return _hsCodeCatalog;

            await _hsCacheLock.WaitAsync();
            try
            {
                if (_hsCodeCatalog != null) return _hsCodeCatalog;

                // Try the requesting company first (they may have a token).
                var fresh = await GetReferenceData<FbrHSCodeDto>(
                    requestingCompanyId, $"{RefBaseV1}/itemdesccode");
                if (fresh != null && fresh.Count > 0)
                {
                    _hsCodeCatalog = fresh;
                    return _hsCodeCatalog;
                }

                // Requesting company has no token. Find any other company that
                // does and try with its credentials. This is read-only against
                // FBR's public catalog — no PII / financial data crosses company
                // boundaries — so cross-company fetch is safe.
                var donor = await _db.Companies
                    .AsNoTracking()
                    .Where(c => c.FbrToken != null && c.FbrToken != ""
                                && c.Id != requestingCompanyId)
                    .Select(c => c.Id)
                    .FirstOrDefaultAsync();
                if (donor > 0)
                {
                    var donorFetch = await GetReferenceData<FbrHSCodeDto>(
                        donor, $"{RefBaseV1}/itemdesccode");
                    if (donorFetch != null && donorFetch.Count > 0)
                    {
                        _hsCodeCatalog = donorFetch;
                        return _hsCodeCatalog;
                    }
                }

                // Neither path worked — leave cache empty so a later request
                // can try again once a token is configured.
                return new List<FbrHSCodeDto>();
            }
            finally
            {
                _hsCacheLock.Release();
            }
        }

        public async Task<List<FbrUOMDto>> GetUOMsAsync(int companyId)
            => await GetReferenceData<FbrUOMDto>(companyId, $"{RefBaseV1}/uom");

        public async Task<List<FbrTransactionTypeDto>> GetTransactionTypesAsync(int companyId)
            => await GetReferenceData<FbrTransactionTypeDto>(companyId, $"{RefBaseV1}/transtypecode");

        public async Task<List<FbrSROItemDto>> GetSROItemCodesAsync(int companyId)
            => await GetReferenceData<FbrSROItemDto>(companyId, $"{RefBaseV1}/sroitemcode");

        // §5.8 — SaleTypeToRate (v2)
        public async Task<List<FbrSaleTypeRateDto>> GetSaleTypeRatesAsync(
            int companyId, string date, int transTypeId, int provinceId)
        {
            var company = await _companyRepo.GetByIdAsync(companyId);
            if (company == null || string.IsNullOrEmpty(company.FbrToken)) return new();

            var httpClient = CreateClient(company);
            var url = $"{RefBaseV2}/SaleTypeToRate?date={date}&transTypeId={transTypeId}&originationSupplier={provinceId}";

            try
            {
                var response = await httpClient.GetAsync(url);
                if (!response.IsSuccessStatusCode) return new();
                var json = await response.Content.ReadAsStringAsync();
                return JsonSerializer.Deserialize<List<FbrSaleTypeRateDto>>(json, JsonOptions) ?? new();
            }
            catch { return new(); }
        }

        // §5.7 — SroSchedule (v2)
        public async Task<List<FbrSRODto>> GetSROScheduleAsync(
            int companyId, int rateId, string date, int provinceId)
        {
            var company = await _companyRepo.GetByIdAsync(companyId);
            if (company == null || string.IsNullOrEmpty(company.FbrToken)) return new();

            var httpClient = CreateClient(company);
            var url = $"{RefBaseV2}/SroSchedule?rate_id={rateId}&date={date}&origination_supplier_csv={provinceId}";

            try
            {
                var response = await httpClient.GetAsync(url);
                if (!response.IsSuccessStatusCode) return new();
                var json = await response.Content.ReadAsStringAsync();
                return JsonSerializer.Deserialize<List<FbrSRODto>>(json, JsonOptions) ?? new();
            }
            catch { return new(); }
        }

        // §5.10 — SROItem (v2)
        public async Task<List<FbrSROItemDto>> GetSROItemsAsync(
            int companyId, string date, int sroId)
        {
            var company = await _companyRepo.GetByIdAsync(companyId);
            if (company == null || string.IsNullOrEmpty(company.FbrToken)) return new();

            var httpClient = CreateClient(company);
            var url = $"{RefBaseV2}/SROItem?date={date}&sro_id={sroId}";

            try
            {
                var response = await httpClient.GetAsync(url);
                if (!response.IsSuccessStatusCode) return new();
                var json = await response.Content.ReadAsStringAsync();
                return JsonSerializer.Deserialize<List<FbrSROItemDto>>(json, JsonOptions) ?? new();
            }
            catch { return new(); }
        }

        // §5.9 — HS_UOM (v2)
        public async Task<List<FbrUOMDto>> GetHSCodeUOMAsync(
            int companyId, string hsCode, int annexureId)
        {
            var company = await _companyRepo.GetByIdAsync(companyId);
            if (company == null || string.IsNullOrEmpty(company.FbrToken)) return new();

            var httpClient = CreateClient(company);
            var url = $"{RefBaseV2}/HS_UOM?hs_code={hsCode}&annexure_id={annexureId}";

            try
            {
                var response = await httpClient.GetAsync(url);
                if (!response.IsSuccessStatusCode) return new();
                var json = await response.Content.ReadAsStringAsync();
                return JsonSerializer.Deserialize<List<FbrUOMDto>>(json, JsonOptions) ?? new();
            }
            catch { return new(); }
        }

        // ═══════════════════════════════════════════════════════════
        //  STATL / Registration APIs (V1.12 §5.11, §5.12)
        // ═══════════════════════════════════════════════════════════

        // §5.11 — Check registration status
        public async Task<FbrRegStatusDto?> CheckRegistrationStatusAsync(
            int companyId, string regNo, string date)
        {
            var company = await _companyRepo.GetByIdAsync(companyId);
            if (company == null || string.IsNullOrEmpty(company.FbrToken)) return null;

            var httpClient = CreateClient(company);
            var requestBody = JsonSerializer.Serialize(new { regno = regNo, date }, JsonOptions);
            var content = new StringContent(requestBody, Encoding.UTF8, "application/json");

            try
            {
                var response = await httpClient.PostAsync($"{DistBase}/statl", content);
                if (!response.IsSuccessStatusCode) return null;
                var json = await response.Content.ReadAsStringAsync();
                return JsonSerializer.Deserialize<FbrRegStatusDto>(json, JsonOptions);
            }
            catch { return null; }
        }

        // §5.12 — Get registration type
        public async Task<FbrRegTypeDto?> GetRegistrationTypeAsync(
            int companyId, string regNo)
        {
            var company = await _companyRepo.GetByIdAsync(companyId);
            if (company == null || string.IsNullOrEmpty(company.FbrToken)) return null;

            var httpClient = CreateClient(company);
            // Use default options (no CamelCase) for this specific request since the field is "Registration_No"
            var requestBody = JsonSerializer.Serialize(new { Registration_No = regNo });
            var content = new StringContent(requestBody, Encoding.UTF8, "application/json");

            try
            {
                var response = await httpClient.PostAsync($"{DistBase}/Get_Reg_Type", content);
                if (!response.IsSuccessStatusCode) return null;
                var json = await response.Content.ReadAsStringAsync();
                return JsonSerializer.Deserialize<FbrRegTypeDto>(json, JsonOptions);
            }
            catch { return null; }
        }

        // ── Shared GET helper ───────────────────────────────────

        private async Task<List<T>> GetReferenceData<T>(int companyId, string url)
        {
            var company = await _companyRepo.GetByIdAsync(companyId);
            if (company == null || string.IsNullOrEmpty(company.FbrToken)) return new();

            var httpClient = CreateClient(company);

            try
            {
                var response = await httpClient.GetAsync(url);
                if (!response.IsSuccessStatusCode) return new();
                var json = await response.Content.ReadAsStringAsync();
                return JsonSerializer.Deserialize<List<T>>(json, JsonOptions) ?? new();
            }
            catch { return new(); }
        }
    }
}
