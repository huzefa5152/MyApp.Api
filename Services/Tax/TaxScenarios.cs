namespace MyApp.Api.Services.Tax
{
    /// <summary>
    /// Canonical FBR scenario catalog — sourced verbatim from the V1.12
    /// Technical Specification:
    ///   • §9  Scenarios for Sandbox Testing       — defines SaleType per SN
    ///   • §10 Applicable Scenarios based on        — defines which SNs apply
    ///         Business Activity                     per (Activity × Sector)
    ///
    /// Two static structures below mirror those tables 1:1 so applicability
    /// can be reverse-derived from the matrix (proof: GetApplicable returns
    /// exactly what §10 says for the (activity, sector) pair we look up).
    ///
    /// Adding a new sector or scenario is a one-row edit in the matching
    /// table — never both. The DB columns (Company.FbrBusinessActivity /
    /// FbrSector) hold a comma-separated list so the same column works for
    /// single-pick legacy values and the new multi-select UI.
    /// </summary>
    public static class TaxScenarios
    {
        public record Scenario(
            string Code,                         // "SN001" .. "SN028"
            string Description,                  // Verbatim from §9 "Description" column
            string SaleType,                     // Verbatim from §9 "Sale Type" column
            decimal DefaultRate,                 // % — best-known default; operator can override
            string BuyerRegistrationType,        // "Registered" | "Unregistered" | "Any"
            bool IsThirdSchedule,
            bool IsEndConsumerRetail,
            bool RequiresSroReference,
            string? DefaultSroScheduleNo = null,
            string? DefaultSroItemSerialNo = null
        );

        // ── Constants for the official Activity × Sector tokens ─────
        public const string ActManufacturer = "Manufacturer";
        public const string ActImporter     = "Importer";
        public const string ActDistributor  = "Distributor";
        public const string ActWholesaler   = "Wholesaler";
        public const string ActExporter     = "Exporter";
        public const string ActRetailer     = "Retailer";
        public const string ActService      = "Service Provider";
        public const string ActOther        = "Other";

        public const string SecAllOther     = "All Other Sectors";
        public const string SecSteel        = "Steel";
        public const string SecFmcg         = "FMCG";
        public const string SecTextile      = "Textile";
        public const string SecTelecom      = "Telecom";
        public const string SecPetroleum    = "Petroleum";
        public const string SecElectricity  = "Electricity Distribution";
        public const string SecGas          = "Gas Distribution";
        public const string SecServices     = "Services";
        public const string SecAutomobile   = "Automobile";
        public const string SecCng          = "CNG Stations";
        public const string SecPharma       = "Pharmaceuticals";
        public const string SecWholesale    = "Wholesale / Retails";

        // ──────────────────────────────────────────────────────────
        // §9 — Scenarios for Sandbox Testing
        // ──────────────────────────────────────────────────────────
        // Order kept stable so SN0xx index === position in PRAL's list.
        // SaleType strings are CHARACTER-EXACT to §9 — FBR rejects with
        // 0013 / 0093 if a single character drifts.
        public static readonly IReadOnlyList<Scenario> All = new List<Scenario>
        {
            new("SN001", "Goods at standard rate to registered buyers",
                "Goods at Standard Rate (default)", 18m, "Registered",
                IsThirdSchedule: false, IsEndConsumerRetail: false, RequiresSroReference: false),

            new("SN002", "Goods at standard rate to unregistered buyers",
                "Goods at Standard Rate (default)", 18m, "Unregistered",
                IsThirdSchedule: false, IsEndConsumerRetail: false, RequiresSroReference: false),

            new("SN003", "Sale of Steel (Melted and Re-Rolled)",
                "Steel Melting and re-rolling", 18m, "Any",
                IsThirdSchedule: false, IsEndConsumerRetail: false, RequiresSroReference: false),

            new("SN004", "Sale by Ship Breakers",
                "Ship breaking", 18m, "Any",
                IsThirdSchedule: false, IsEndConsumerRetail: false, RequiresSroReference: false),

            new("SN005", "Reduced rate sale",
                "Goods at Reduced Rate", 5m, "Any",
                IsThirdSchedule: false, IsEndConsumerRetail: false,
                RequiresSroReference: true,
                DefaultSroScheduleNo: "EIGHTH SCHEDULE Table 1", DefaultSroItemSerialNo: "1"),

            new("SN006", "Exempt goods sale",
                "Exempt Goods", 0m, "Any",
                IsThirdSchedule: false, IsEndConsumerRetail: false,
                RequiresSroReference: true,
                DefaultSroScheduleNo: "SIXTH SCHEDULE Table 1", DefaultSroItemSerialNo: "1"),

            new("SN007", "Zero rated sale",
                "Goods at zero-rate", 0m, "Any",
                IsThirdSchedule: false, IsEndConsumerRetail: false,
                RequiresSroReference: true,
                DefaultSroScheduleNo: "FIFTH SCHEDULE", DefaultSroItemSerialNo: "1"),

            new("SN008", "Sale of 3rd schedule goods",
                "3rd Schedule Goods", 18m, "Any",
                IsThirdSchedule: true, IsEndConsumerRetail: false, RequiresSroReference: false),

            new("SN009", "Cotton Spinners purchase from Cotton Ginners (Textile Sector)",
                "Cotton Ginners", 10m, "Any",
                IsThirdSchedule: false, IsEndConsumerRetail: false, RequiresSroReference: false),

            new("SN010", "Telecom services rendered or provided",
                "Telecommunication services", 19.5m, "Any",
                IsThirdSchedule: false, IsEndConsumerRetail: false, RequiresSroReference: false),

            new("SN011", "Toll Manufacturing sale by Steel sector",
                "Toll Manufacturing", 18m, "Registered",
                IsThirdSchedule: false, IsEndConsumerRetail: false, RequiresSroReference: false),

            new("SN012", "Sale of Petroleum products",
                "Petroleum Products", 17m, "Any",
                IsThirdSchedule: false, IsEndConsumerRetail: false, RequiresSroReference: false),

            new("SN013", "Electricity Supply to Retailers",
                "Electricity Supply to Retailers", 17m, "Registered",
                IsThirdSchedule: false, IsEndConsumerRetail: false, RequiresSroReference: false),

            new("SN014", "Sale of Gas to CNG stations",
                "Gas to CNG stations", 17m, "Registered",
                IsThirdSchedule: false, IsEndConsumerRetail: false, RequiresSroReference: false),

            new("SN015", "Sale of mobile phones",
                "Mobile Phones", 18m, "Any",
                IsThirdSchedule: false, IsEndConsumerRetail: false,
                RequiresSroReference: true,
                DefaultSroScheduleNo: "NINTH SCHEDULE", DefaultSroItemSerialNo: "1"),

            new("SN016", "Processing / Conversion of Goods",
                "Processing/ Conversion of Goods", 18m, "Registered",
                IsThirdSchedule: false, IsEndConsumerRetail: false, RequiresSroReference: false),

            new("SN017", "Sale of Goods where FED is charged in ST mode",
                "Goods (FED in ST Mode)", 18m, "Any",
                IsThirdSchedule: false, IsEndConsumerRetail: false, RequiresSroReference: false),

            new("SN018", "Services rendered or provided where FED is charged in ST mode",
                "Services (FED in ST Mode)", 18m, "Any",
                IsThirdSchedule: false, IsEndConsumerRetail: false, RequiresSroReference: false),

            new("SN019", "Services rendered or provided",
                "Services", 16m, "Any",
                IsThirdSchedule: false, IsEndConsumerRetail: false, RequiresSroReference: false),

            new("SN020", "Sale of Electric Vehicles",
                "Electric Vehicle", 1m, "Any",
                IsThirdSchedule: false, IsEndConsumerRetail: false, RequiresSroReference: false),

            new("SN021", "Sale of Cement / Concrete Block",
                "Cement /Concrete Block", 18m, "Any",
                IsThirdSchedule: false, IsEndConsumerRetail: false, RequiresSroReference: false),

            new("SN022", "Sale of Potassium Chlorate",
                "Potassium Chlorate", 18m, "Any",
                IsThirdSchedule: false, IsEndConsumerRetail: false, RequiresSroReference: false),

            new("SN023", "Sale of CNG",
                "CNG Sales", 18m, "Any",
                IsThirdSchedule: false, IsEndConsumerRetail: false, RequiresSroReference: false),

            new("SN024", "Goods sold that are listed in SRO 297(I)/2023",
                "Goods as per SRO.297(|)/2023", 18m, "Any",
                IsThirdSchedule: false, IsEndConsumerRetail: false,
                RequiresSroReference: true,
                DefaultSroScheduleNo: "SRO 297(I)/2023", DefaultSroItemSerialNo: "1"),

            new("SN025", "Drugs sold at fixed ST rate under serial 81 of Eighth Schedule Table 1",
                "Non-Adjustable Supplies", 1m, "Any",
                IsThirdSchedule: false, IsEndConsumerRetail: false,
                RequiresSroReference: true,
                DefaultSroScheduleNo: "EIGHTH SCHEDULE Table 1", DefaultSroItemSerialNo: "81"),

            new("SN026", "Sale to End Consumer by retailers (standard rate)",
                "Goods at Standard Rate (default)", 18m, "Unregistered",
                IsThirdSchedule: false, IsEndConsumerRetail: true, RequiresSroReference: false),

            new("SN027", "Sale to End Consumer by retailers (3rd Schedule)",
                "3rd Schedule Goods", 18m, "Unregistered",
                IsThirdSchedule: true, IsEndConsumerRetail: true, RequiresSroReference: false),

            new("SN028", "Sale to End Consumer by retailers (reduced rate)",
                "Goods at Reduced Rate", 1m, "Unregistered",
                IsThirdSchedule: false, IsEndConsumerRetail: true,
                RequiresSroReference: true,
                DefaultSroScheduleNo: "EIGHTH SCHEDULE Table 1",
                DefaultSroItemSerialNo: "70"),
        };

        public const string DefaultCode = "SN001";

        // ──────────────────────────────────────────────────────────
        // §10 — Applicable Scenarios based on Business Activity
        // ──────────────────────────────────────────────────────────
        // Source of truth for which SNs apply per (Activity × Sector).
        // Entries copied verbatim from the spec table; do NOT reorder
        // because seed scripts iterate in this order. To extend coverage:
        // add a row, nothing else. Empty row = "no FBR scenarios apply"
        // (e.g. an unsupported sector for that activity).
        private static readonly Dictionary<(string Activity, string Sector), string[]> Matrix = new()
        {
            // Manufacturer
            [(ActManufacturer, SecAllOther)]    = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024" },
            [(ActManufacturer, SecSteel)]       = new[] { "SN003","SN004","SN011" },
            [(ActManufacturer, SecFmcg)]        = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN008" },
            [(ActManufacturer, SecTextile)]     = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN009" },
            [(ActManufacturer, SecTelecom)]     = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN010" },
            [(ActManufacturer, SecPetroleum)]   = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN012" },
            [(ActManufacturer, SecElectricity)] = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN013" },
            [(ActManufacturer, SecGas)]         = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN014" },
            [(ActManufacturer, SecServices)]    = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN018","SN019" },
            [(ActManufacturer, SecAutomobile)]  = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN020" },
            [(ActManufacturer, SecCng)]         = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN023" },
            [(ActManufacturer, SecPharma)]      = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024" },
            [(ActManufacturer, SecWholesale)]   = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN026","SN027","SN028","SN008" },

            // Importer
            [(ActImporter, SecAllOther)]    = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024" },
            [(ActImporter, SecSteel)]       = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN003","SN004","SN011" },
            [(ActImporter, SecFmcg)]        = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN008" },
            [(ActImporter, SecTextile)]     = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN009" },
            [(ActImporter, SecTelecom)]     = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN010" },
            [(ActImporter, SecPetroleum)]   = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN012" },
            [(ActImporter, SecElectricity)] = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN013" },
            [(ActImporter, SecGas)]         = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN014" },
            [(ActImporter, SecServices)]    = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN018","SN019" },
            [(ActImporter, SecAutomobile)]  = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN020" },
            [(ActImporter, SecCng)]         = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN023" },
            [(ActImporter, SecPharma)]      = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN025" },
            [(ActImporter, SecWholesale)]   = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN026","SN027","SN028","SN008" },

            // Distributor — note the spec lists SN008 twice in some rows; we de-dup at output time.
            [(ActDistributor, SecAllOther)]    = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN026","SN027","SN028","SN008" },
            [(ActDistributor, SecSteel)]       = new[] { "SN003","SN004","SN011","SN026","SN027","SN028","SN008" },
            [(ActDistributor, SecFmcg)]        = new[] { "SN008","SN026","SN027","SN028" },
            [(ActDistributor, SecTextile)]     = new[] { "SN009","SN026","SN027","SN028","SN008" },
            [(ActDistributor, SecTelecom)]     = new[] { "SN010","SN026","SN027","SN028","SN008" },
            [(ActDistributor, SecPetroleum)]   = new[] { "SN012","SN026","SN027","SN028","SN008" },
            [(ActDistributor, SecElectricity)] = new[] { "SN013","SN026","SN027","SN028","SN008" },
            [(ActDistributor, SecGas)]         = new[] { "SN014","SN026","SN027","SN028","SN008" },
            [(ActDistributor, SecServices)]    = new[] { "SN018","SN019","SN026","SN027","SN028","SN008" },
            [(ActDistributor, SecAutomobile)]  = new[] { "SN020","SN026","SN027","SN028","SN008" },
            [(ActDistributor, SecCng)]         = new[] { "SN023","SN026","SN027","SN028","SN008" },
            [(ActDistributor, SecPharma)]      = new[] { "SN025","SN026","SN027","SN028","SN008" },
            [(ActDistributor, SecWholesale)]   = new[] { "SN001","SN002","SN026","SN027","SN028","SN008" },

            // Wholesaler — spec rows 46–58
            [(ActWholesaler, SecAllOther)]    = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN026","SN027","SN028","SN008" },
            [(ActWholesaler, SecSteel)]       = new[] { "SN003","SN004","SN011","SN026","SN027","SN028","SN008" },
            [(ActWholesaler, SecFmcg)]        = new[] { "SN008","SN026","SN027","SN028" },
            [(ActWholesaler, SecTextile)]     = new[] { "SN009","SN026","SN027","SN028","SN008" },
            [(ActWholesaler, SecTelecom)]     = new[] { "SN010","SN026","SN027","SN028","SN008" },
            [(ActWholesaler, SecPetroleum)]   = new[] { "SN012","SN026","SN027","SN028","SN008" },
            [(ActWholesaler, SecElectricity)] = new[] { "SN013","SN026","SN027","SN028","SN008" },
            [(ActWholesaler, SecGas)]         = new[] { "SN014","SN026","SN027","SN028","SN008" },
            [(ActWholesaler, SecServices)]    = new[] { "SN018","SN019","SN026","SN027","SN028","SN008" },
            [(ActWholesaler, SecAutomobile)]  = new[] { "SN020","SN026","SN027","SN028","SN008" },
            [(ActWholesaler, SecCng)]         = new[] { "SN023","SN026","SN027","SN028","SN008" },
            [(ActWholesaler, SecPharma)]      = new[] { "SN025","SN026","SN027","SN028","SN008" },
            [(ActWholesaler, SecWholesale)]   = new[] { "SN001","SN002","SN026","SN027","SN028","SN008" },

            // Exporter — spec rows 61–73 (mirrors Importer + sector-specific scenarios)
            [(ActExporter, SecAllOther)]    = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024" },
            [(ActExporter, SecSteel)]       = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN003","SN004","SN011" },
            [(ActExporter, SecFmcg)]        = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN008" },
            [(ActExporter, SecTextile)]     = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN009" },
            [(ActExporter, SecTelecom)]     = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN010" },
            [(ActExporter, SecPetroleum)]   = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN012" },
            [(ActExporter, SecElectricity)] = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN013" },
            [(ActExporter, SecGas)]         = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN014" },
            [(ActExporter, SecServices)]    = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN018","SN019" },
            [(ActExporter, SecAutomobile)]  = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN020" },
            [(ActExporter, SecCng)]         = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN023" },
            [(ActExporter, SecPharma)]      = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN025" },
            [(ActExporter, SecWholesale)]   = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN026","SN027","SN028","SN008" },

            // Retailer — spec rows 76–88
            [(ActRetailer, SecAllOther)]    = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN026","SN027","SN028","SN008" },
            [(ActRetailer, SecSteel)]       = new[] { "SN003","SN004","SN011" },
            [(ActRetailer, SecFmcg)]        = new[] { "SN026","SN027","SN028","SN008" },
            [(ActRetailer, SecTextile)]     = new[] { "SN009","SN026","SN027","SN028","SN008" },
            [(ActRetailer, SecTelecom)]     = new[] { "SN010","SN026","SN027","SN028","SN008" },
            [(ActRetailer, SecPetroleum)]   = new[] { "SN012","SN026","SN027","SN028","SN008" },
            [(ActRetailer, SecElectricity)] = new[] { "SN013","SN026","SN027","SN028","SN008" },
            [(ActRetailer, SecGas)]         = new[] { "SN014","SN026","SN027","SN028","SN008" },
            [(ActRetailer, SecServices)]    = new[] { "SN018","SN019","SN026","SN027","SN028","SN008" },
            [(ActRetailer, SecAutomobile)]  = new[] { "SN020","SN026","SN027","SN028","SN008" },
            [(ActRetailer, SecCng)]         = new[] { "SN023","SN026","SN027","SN028","SN008" },
            [(ActRetailer, SecPharma)]      = new[] { "SN025","SN026","SN027","SN028","SN008" },
            [(ActRetailer, SecWholesale)]   = new[] { "SN026","SN027","SN028","SN008" },

            // Service Provider — spec rows 91–103
            [(ActService, SecAllOther)]    = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN018","SN019" },
            [(ActService, SecSteel)]       = new[] { "SN003","SN004","SN011","SN018","SN019" },
            [(ActService, SecFmcg)]        = new[] { "SN008","SN018","SN019" },
            [(ActService, SecTextile)]     = new[] { "SN009","SN018","SN019" },
            [(ActService, SecTelecom)]     = new[] { "SN010","SN018","SN019" },
            [(ActService, SecPetroleum)]   = new[] { "SN012","SN018","SN019" },
            [(ActService, SecElectricity)] = new[] { "SN013","SN018","SN019" },
            [(ActService, SecGas)]         = new[] { "SN014","SN018","SN019" },
            [(ActService, SecServices)]    = new[] { "SN018","SN019" },
            [(ActService, SecAutomobile)]  = new[] { "SN020","SN018","SN019" },
            [(ActService, SecCng)]         = new[] { "SN023","SN018","SN019" },
            [(ActService, SecPharma)]      = new[] { "SN025","SN018","SN019" },
            [(ActService, SecWholesale)]   = new[] { "SN026","SN027","SN028","SN008","SN018","SN019" },

            // Other — spec rows 106–118 (mirrors Importer pattern)
            [(ActOther, SecAllOther)]    = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024" },
            [(ActOther, SecSteel)]       = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN003","SN004","SN011" },
            [(ActOther, SecFmcg)]        = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN008" },
            [(ActOther, SecTextile)]     = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN009" },
            [(ActOther, SecTelecom)]     = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN010" },
            [(ActOther, SecPetroleum)]   = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN012" },
            [(ActOther, SecElectricity)] = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN013" },
            [(ActOther, SecGas)]         = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN014" },
            [(ActOther, SecServices)]    = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN018","SN019" },
            [(ActOther, SecAutomobile)]  = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN020" },
            [(ActOther, SecCng)]         = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN023" },
            [(ActOther, SecPharma)]      = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN025" },
            [(ActOther, SecWholesale)]   = new[] { "SN001","SN002","SN005","SN006","SN007","SN015","SN016","SN017","SN021","SN022","SN024","SN026","SN027","SN028","SN008" },
        };

        // ──────────────────────────────────────────────────────────
        // Public lookups
        // ──────────────────────────────────────────────────────────

        public static Scenario? Find(string? code)
            => string.IsNullOrWhiteSpace(code)
               ? null
               : All.FirstOrDefault(s =>
                   string.Equals(s.Code, code, StringComparison.OrdinalIgnoreCase));

        /// <summary>
        /// Returns the SN scenarios that apply to a company's profile,
        /// strictly per §10. Order is preserved (so seed scripts walk
        /// scenarios in spec order). Empty profile → returns all 28.
        /// </summary>
        public static IReadOnlyList<Scenario> GetApplicable(
            IEnumerable<string>? activities, IEnumerable<string>? sectors)
        {
            var actSet = (activities ?? Array.Empty<string>())
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .Select(s => s.Trim())
                .ToList();
            var secSet = (sectors ?? Array.Empty<string>())
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .Select(s => s.Trim())
                .ToList();

            // No profile declared → operator hasn't decided yet; return the
            // full menu so the UI can show what could apply.
            if (actSet.Count == 0 && secSet.Count == 0) return All;

            // Union the (Activity × Sector) row sets. Distinct preserves
            // first-appearance order from §9 because All is already in
            // canonical order; we hit it via .OrderBy on All below.
            var union = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var a in actSet)
            foreach (var s in secSet)
                if (Matrix.TryGetValue(MatchKey(a, s), out var sns))
                    foreach (var sn in sns) union.Add(sn);

            return All.Where(sc => union.Contains(sc.Code)).ToList();
        }

        // Resolve a free-text activity/sector to the canonical token by
        // case-insensitive trim match. Operators sometimes store "wholesaler"
        // vs "Wholesaler"; matching tolerantly avoids dropping rows.
        private static (string Activity, string Sector) MatchKey(string activity, string sector)
        {
            string a = activity.Trim(), s = sector.Trim();
            foreach (var key in Matrix.Keys)
            {
                if (string.Equals(key.Activity, a, StringComparison.OrdinalIgnoreCase)
                    && string.Equals(key.Sector, s, StringComparison.OrdinalIgnoreCase))
                    return key;
            }
            return (a, s);  // unknown — Matrix.TryGetValue will miss, returning empty
        }

        /// <summary>
        /// Heuristic scenario inference when the operator hasn't tagged the
        /// bill explicitly. Used by TaxMappingEngine.Resolve as a fallback.
        /// </summary>
        public static Scenario? InferFromFacts(decimal rate, string? buyerRegType, bool isThirdSchedule)
        {
            var reg = string.IsNullOrWhiteSpace(buyerRegType) ? "Registered" : buyerRegType!;
            return All.FirstOrDefault(s =>
                s.DefaultRate == rate
                && s.IsThirdSchedule == isThirdSchedule
                && (s.BuyerRegistrationType == "Any" || s.BuyerRegistrationType == reg));
        }

        public static string[] SplitCsv(string? csv)
            => string.IsNullOrWhiteSpace(csv)
                ? Array.Empty<string>()
                : csv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
    }
}
