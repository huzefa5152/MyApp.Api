using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Tax
{
    /// <summary>
    /// Decides the FBR-compliant combination of UOM, SaleType, Rate and
    /// SRO references for a given (HSCode, scenario, date, sector) input.
    ///
    /// Why a dedicated engine and not just inline calls to FbrService?
    /// FBR validates four interlocking facts on every line item:
    ///   • HSCode → must have a matching UOM (HS_UOM)
    ///   • TransactionType → SaleType → Rate (SaleTypeToRate)
    ///   • Scenario → fixes SaleType, Rate, end-consumer flag, 3rd-schedule flag
    ///   • Rate ≠ 18 % → SRO Schedule + Item required (FBR rule 0077)
    ///
    /// Without a single resolver, those facts drift between the catalog
    /// (ItemType), the bill UI, and the submission payload — producing
    /// "0052 invalid combination" errors at the FBR side. This engine is
    /// the *only* place that decides them, so they can't drift.
    /// </summary>
    public interface ITaxMappingEngine
    {
        /// <summary>
        /// Given an HS Code, return the FBR-published valid UOMs. Cached
        /// per (companyId, hsCode) for the process lifetime — the FBR
        /// catalog rarely changes within a working day.
        /// </summary>
        Task<List<FbrUOMDto>> GetValidUomsForHsCodeAsync(int companyId, string hsCode);

        /// <summary>
        /// Picks the single best UOM for an HS Code (first FBR-published
        /// match, or null if FBR has none mapped). Used when saving an
        /// ItemType so the user doesn't have to scroll the full UOM list.
        /// </summary>
        Task<FbrUOMDto?> SuggestDefaultUomAsync(int companyId, string hsCode);

        /// <summary>
        /// Resolves rate + sale type + SRO reference for a given scenario
        /// (and date / province for SaleTypeToRate lookup). Returns the
        /// canonical FBR strings — what the submit payload should set.
        /// </summary>
        Task<TaxResolution> ResolveAsync(TaxResolutionInput input);

        /// <summary>
        /// Pre-flight combination check that runs before submitting to FBR.
        /// Catches the four classes of "invalid combo" mistakes that produce
        /// 0052/0077/0019/0102 errors from the FBR side.
        /// </summary>
        Task<List<string>> ValidateCombinationAsync(TaxResolutionInput input, decimal lineTotal, decimal? retailPrice);

        /// <summary>
        /// Bundles every suggestion we can make for a freshly-typed HS Code
        /// on the Item Type form: valid UOMs, suggested default UOM, valid
        /// (rate, sale-type, rate-id) options for the company's province +
        /// today + transactionType=18 (goods sale), and a single
        /// "best guess" default rate + sale type the UI can pre-fill.
        ///
        /// Lets the operator just type an HS code and see "this commonly
        /// uses Numbers/pieces/units, 18% standard rate" without needing
        /// to know the FBR scenario catalog.
        /// </summary>
        Task<HsCodeHints> GetHsCodeHintsAsync(int companyId, string hsCode);
    }

    public record HsCodeHints(
        List<FbrUOMDto> Uoms,
        FbrUOMDto? DefaultUom,
        List<RateOption> RateOptions,
        decimal DefaultRate,           // % — what to pre-fill on the bill
        string DefaultSaleType,        // FBR-published sale-type label
        List<string> Notes             // human-readable explanation of the suggestions
    );

    public record RateOption(
        int RateId,
        string RateDesc,
        decimal RateValue              // % numeric
    );

    public record TaxResolutionInput(
        int CompanyId,
        string? HsCode,
        string? ScenarioCode,            // SN001 etc.; null → infer from facts
        decimal Rate,                    // % entered on the bill
        string BuyerRegistrationType,    // "Registered" | "Unregistered"
        DateTime InvoiceDate,
        int? ProvinceCode,               // seller province
        int? TransactionTypeId,          // FBR transaction-type id (default 18 = Goods)
        string? SaleTypeOverride,        // user-supplied; null → engine picks
        string? Uom = null,              // line UoM string — used by HS_UOM pre-flight check
        int? FbrUomId = null             // line UoM id — used by HS_UOM pre-flight check
    );

    public record TaxResolution(
        string SaleType,
        decimal Rate,
        string? SroScheduleNo,
        string? SroItemSerialNo,
        string ScenarioCode,             // resolved code (never null)
        bool IsThirdSchedule,
        bool IsEndConsumerRetail,
        List<string> Notes               // human-readable explanation of decisions made
    );
}
