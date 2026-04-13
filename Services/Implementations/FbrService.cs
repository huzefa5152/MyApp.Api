using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class FbrService : IFbrService
    {
        private readonly IInvoiceRepository _invoiceRepo;
        private readonly ICompanyRepository _companyRepo;
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IAuditLogService _auditLog;

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

        private static readonly JsonSerializerOptions JsonOptions = new()
        {
            PropertyNameCaseInsensitive = true,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
        };

        // Document type int → FBR string
        private static readonly Dictionary<int, string> DocTypeMap = new()
        {
            { 4, "Sale Invoice" },
            { 9, "Debit Note" },
            { 10, "Credit Note" }
        };

        public FbrService(
            IInvoiceRepository invoiceRepo,
            ICompanyRepository companyRepo,
            IHttpClientFactory httpClientFactory,
            IAuditLogService auditLogService)
        {
            _invoiceRepo = invoiceRepo;
            _companyRepo = companyRepo;
            _httpClientFactory = httpClientFactory;
            _auditLog = auditLogService;
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

        private async Task<string> ResolveProvinceNameAsync(Company company, int? provinceCode)
        {
            if (provinceCode == null) return "";

            if (!_provinceCache.TryGetValue(company.Id, out var map))
            {
                try
                {
                    var provinces = await GetProvincesAsync(company.Id);
                    map = provinces.ToDictionary(p => p.StateProvinceCode, p => p.StateProvinceDesc);
                    _provinceCache.TryAdd(company.Id, map); // Thread-safe, only cache successful results
                }
                catch
                {
                    map = new Dictionary<int, string>();
                    // Don't cache failed lookups — retry next time
                }
            }

            return map.TryGetValue(provinceCode.Value, out var name) ? name : "";
        }

        private async Task<string> ResolveUomDesc(Company company, int? uomId, string? fallback)
        {
            if (uomId == null) return fallback ?? "";

            if (!_uomCache.TryGetValue(company.Id, out var map))
            {
                try
                {
                    var uoms = await GetUOMsAsync(company.Id);
                    map = uoms.ToDictionary(u => u.UOM_ID, u => u.Description);
                    _uomCache.TryAdd(company.Id, map); // Thread-safe, only cache successful results
                }
                catch { map = new Dictionary<int, string>(); }
            }

            return map.TryGetValue(uomId.Value, out var desc) ? desc : fallback ?? "";
        }

        // ── Pre-validation (before calling FBR) ─────────────────

        private FbrSubmissionResult? PreValidate(Invoice invoice, Company company, Client buyer)
        {
            var errors = new List<string>();
            // Strip all non-digit characters from NTN/CNIC
            // Pakistan NTN: "XXXXXXX-Y" → "XXXXXXXY" → take first 7 via Split, or just digits
            // Pakistan CNIC: "XXXXX-XXXXXXX-X" → "XXXXXXXXXXXXX" (13 digits)
            static string StripDigits(string? v)
            {
                if (string.IsNullOrWhiteSpace(v)) return "";
                return new string(v.Where(char.IsDigit).ToArray());
            }
            // For NTN specifically: extract base 7 digits (strip check digit)
            static string StripNtn(string? v)
            {
                if (string.IsNullOrWhiteSpace(v)) return "";
                v = v.Trim();
                if (v.Contains('-')) v = v.Split('-')[0];
                return new string(v.Where(char.IsDigit).ToArray());
            }

            // ─ Seller ─
            var sellerNtn = StripNtn(company.NTN);
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
            var invoiceTypeStr = DocTypeMap.GetValueOrDefault(invoice.DocumentType ?? 4, "Sale Invoice");
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
                    if (item.FbrUOMId == null)
                        errors.Add($"Item {n}: FBR UOM is required. Select a UOM from the FBR reference list.");
                    if (item.Quantity <= 0)
                        errors.Add($"Item {n}: Quantity must be greater than zero. [FBR 0098]");
                    if (item.LineTotal <= 0)
                        errors.Add($"Item {n}: Value of Sales must be greater than zero. [FBR 0021]");
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
            => await PostInvoiceAsync(invoiceId, isSubmit: true, scenarioId);

        public async Task<FbrSubmissionResult> ValidateInvoiceAsync(int invoiceId, string? scenarioId = null)
            => await PostInvoiceAsync(invoiceId, isSubmit: false, scenarioId);

        private async Task<FbrSubmissionResult> PostInvoiceAsync(int invoiceId, bool isSubmit, string? scenarioId)
        {
            // ── Load entities ──
            var invoice = await _invoiceRepo.GetByIdAsync(invoiceId);
            if (invoice == null)
                return Fail("Invoice not found.");

            var company = await _companyRepo.GetByIdAsync(invoice.CompanyId);
            if (company == null)
                return Fail("Company not found.");

            if (string.IsNullOrEmpty(company.FbrToken))
                return Fail("FBR token is not configured for this company. Go to Company settings → FBR Token.");

            var buyer = invoice.Client;
            if (buyer == null)
                return Fail("Invoice client data is missing.");

            bool isSandbox = company.FbrEnvironment != "production";

            // ── Pre-validate ──
            var preResult = PreValidate(invoice, company, buyer);
            if (preResult != null) return preResult;

            // ── Resolve province names ──
            var sellerProvince = await ResolveProvinceNameAsync(company, company.FbrProvinceCode);
            var buyerProvince = await ResolveProvinceNameAsync(company, buyer.FbrProvinceCode);

            if (string.IsNullOrEmpty(sellerProvince))
                return Fail($"Could not resolve seller province code {company.FbrProvinceCode} to a name. Check FBR Province in Company settings or verify FBR token is valid.");
            if (string.IsNullOrEmpty(buyerProvince))
                return Fail($"Could not resolve buyer province code {buyer.FbrProvinceCode} to a name. Check FBR Province on the Client.");

            // ── Determine buyer NTN/CNIC ──
            var buyerRegType = MapBuyerRegType(buyer.RegistrationType);
            var buyerNtnCnic = !string.IsNullOrEmpty(buyer.NTN) ? buyer.NTN
                             : !string.IsNullOrEmpty(buyer.CNIC) ? buyer.CNIC
                             : "";
            // For unregistered buyers, buyerNTNCNIC is optional per V1.12
            if (buyerRegType == "Unregistered" && string.IsNullOrEmpty(buyerNtnCnic))
                buyerNtnCnic = "";

            // ── Sanitize NTN/CNIC ──
            // NTN: "XXXXXXX-Y" → strip check digit after dash → 7 digits
            // CNIC: "XXXXX-XXXXXXX-X" → strip ALL non-digits → 13 digits
            static string StripAllDigits(string? v)
            {
                if (string.IsNullOrWhiteSpace(v)) return "";
                return new string(v.Where(char.IsDigit).ToArray());
            }
            static string SanitizeNtn(string? ntn)
            {
                if (string.IsNullOrWhiteSpace(ntn)) return "";
                ntn = ntn.Trim();
                if (ntn.Contains('-')) ntn = ntn.Split('-')[0];
                return new string(ntn.Where(char.IsDigit).ToArray());
            }

            // Seller is always NTN (7 digits)
            var sellerNtnCnic = SanitizeNtn(company.NTN);
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
                InvoiceType = DocTypeMap.GetValueOrDefault(invoice.DocumentType ?? 4, "Sale Invoice"),
                InvoiceDate = invoice.Date.ToString("yyyy-MM-dd"),
                SellerNTNCNIC = sellerNtnCnic,
                SellerBusinessName = company.Name,
                SellerProvince = sellerProvince,
                SellerAddress = company.FullAddress ?? "",
                BuyerNTNCNIC = buyerNtnCnic,
                BuyerBusinessName = buyer.Name,
                BuyerProvince = buyerProvince,
                BuyerAddress = buyer.Address ?? "",
                BuyerRegistrationType = buyerRegType,
                InvoiceRefNo = (invoice.DocumentType == 9 || invoice.DocumentType == 10) ? (invoice.FbrIRN ?? "") : "",
                ScenarioId = isSandbox ? (scenarioId ?? "SN001") : null,
                Items = new List<FbrInvoiceItemRequest>()
            };

            // Resolve UOM descriptions from FBR reference (async, so can't use LINQ Select)
            foreach (var item in invoice.Items)
            {
                var salesTax = Math.Round(item.LineTotal * invoice.GSTRate / 100, 2);
                var uomDesc = await ResolveUomDesc(company, item.FbrUOMId, item.UOM);
                fbrRequest.Items.Add(new FbrInvoiceItemRequest
                {
                    HsCode = item.HSCode ?? "",
                    ProductDescription = item.Description,
                    Rate = $"{invoice.GSTRate:0.##}%",
                    UoM = uomDesc,
                    Quantity = item.Quantity,
                    TotalValues = 0,
                    ValueSalesExcludingST = item.LineTotal,
                    FixedNotifiedValueOrRetailPrice = 0,
                    SalesTaxApplicable = salesTax,
                    SalesTaxWithheldAtSource = 0,
                    ExtraTax = 0,
                    FurtherTax = 0,
                    SroScheduleNo = "",
                    FedPayable = 0,
                    Discount = 0,
                    SaleType = item.SaleType ?? "Goods at standard rate (default)",
                    SroItemSerialNo = ""
                });
            }

            // ── Call FBR API ──
            var action = isSubmit ? "Submit" : "Validate";
            var url = isSubmit ? GetSubmitUrl(company) : GetValidateUrl(company);
            var json = JsonSerializer.Serialize(fbrRequest, JsonOptions);

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

                // ── Pattern 1: Header-level error (statusCode "01", invoiceStatuses null) ──
                if (validation.StatusCode == "01")
                {
                    var msg = !string.IsNullOrEmpty(validation.ErrorCode)
                        ? $"[{validation.ErrorCode}] {validation.Error}"
                        : validation.Error ?? "FBR header validation failed.";
                    await AuditFbr("Warning", action, invoice.Id, url, json, responseBody, 200, msg);
                    if (isSubmit) await PersistStatus(invoice, "Failed", null, msg);
                    return new FbrSubmissionResult { Success = false, FbrStatus = "Failed", ErrorMessage = msg };
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
                        await PersistStatus(invoice, "Submitted", irn, null);

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

        public async Task<List<FbrHSCodeDto>> GetHSCodesAsync(int companyId, string? search = null)
        {
            var all = await GetReferenceData<FbrHSCodeDto>(companyId, $"{RefBaseV1}/itemdesccode");
            if (!string.IsNullOrWhiteSpace(search))
            {
                var term = search.ToLower();
                all = all.Where(h =>
                    h.HS_CODE.ToLower().Contains(term) ||
                    h.Description.ToLower().Contains(term)
                ).Take(50).ToList();
            }
            return all;
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
