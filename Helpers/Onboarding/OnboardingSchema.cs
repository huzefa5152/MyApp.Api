namespace MyApp.Api.Helpers.Onboarding
{
    /// <summary>
    /// The sheets of the onboarding workbook. <see cref="ImportOrder"/> is the
    /// order a commit writes them in: items before opening stock, because an
    /// opening-stock row may name an item that arrives on the Items sheet of
    /// the same file.
    /// </summary>
    public static class OnboardingSheets
    {
        public const string Customers = "customers";
        public const string Items = "items";
        public const string Suppliers = "suppliers";
        public const string OpeningStock = "openingStock";

        public static readonly string[] ImportOrder = { Items, Customers, Suppliers, OpeningStock };
    }

    public enum Requirement { Required, Conditional, Optional }

    public enum ListSource { None, Province, RegistrationType, SaleType, Unit }

    /// <summary>
    /// How a cell is read. Identifier cells (NTN, CNIC, phone, HS code) are
    /// digits the operator may have typed as a NUMBER, which Excel shows in
    /// scientific notation once it passes 11 digits; the reader turns them
    /// back into the digits.
    /// </summary>
    public enum ColumnKind { Text, Identifier, Number, Date }

    public record OnboardingColumn(
        string Key,
        string Heading,
        Requirement Requirement,
        string Help,
        ListSource List = ListSource.None,
        ColumnKind Kind = ColumnKind.Text,
        int Width = 22,
        string[]? Aliases = null);

    public record OnboardingSheet(
        string Key,
        string Title,
        string Purpose,
        string PermissionKey,
        IReadOnlyList<OnboardingColumn> Columns);

    /// <summary>
    /// The ONE definition of what the onboarding workbook holds. The sample
    /// builder, the reader, the row rules and the preview messages all read
    /// it, so the sample can never promise a column the import does not
    /// understand. Only fields that FBR submission or a print template reads
    /// are asked for — Client.Email, for one, is deliberately absent.
    /// </summary>
    public static class OnboardingSchema
    {
        public const int HeaderRow = 1;
        public const int HelpRow = 2;
        public const int FirstDataRow = 3;
        public const int MaxRowsPerSheet = 5000;
        public const int MaxHeadingColumns = 40;

        public const string DefaultSaleType = "Goods at standard rate (default)";

        /// <summary>The Item Type form's sale types, in its order (ItemTypeForm.jsx SALE_TYPES).</summary>
        public static readonly string[] SaleTypes =
        {
            "Goods at standard rate (default)",
            "Goods at Reduced Rate",
            "Goods at zero-rate",
            "Exempt goods",
            "3rd Schedule Goods",
            "Services",
            "Services (FED in ST Mode)",
            "Goods (FED in ST Mode)",
            "Steel Melting and re-rolling",
            "Toll Manufacturing",
            "Mobile Phones",
            "Petroleum Products",
            "Electric Vehicle",
            "Cement /Concrete Block",
            "Processing/Conversion of Goods",
            "Cotton Ginners",
            "Non-Adjustable Supplies",
        };

        private static OnboardingColumn[] Party(bool provinceRequired, string who) => new[]
        {
            new OnboardingColumn("name", "Name", Requirement.Required,
                $"The {who}'s business name, as it should print on documents. Each name once.",
                Width: 34, Aliases: new[] { $"{who} name", "business name" }),
            new OnboardingColumn("registrationType", "Registration Type", Requirement.Required,
                "Pick from the list: Registered, Unregistered, FTN or CNIC.",
                ListSource.RegistrationType, Width: 20),
            new OnboardingColumn("ntn", "NTN", Requirement.Conditional,
                "7 digits, e.g. 1234567 (1234567-8 is fine). Required when Registration Type is Registered or FTN.",
                Kind: ColumnKind.Identifier, Width: 16),
            new OnboardingColumn("cnic", "CNIC", Requirement.Conditional,
                "13 digits, dashes optional, e.g. 42101-1234567-1. Required when Registration Type is CNIC.",
                Kind: ColumnKind.Identifier, Width: 20),
            new OnboardingColumn("province", "Province",
                provinceRequired ? Requirement.Required : Requirement.Optional,
                provinceRequired
                    ? "Pick from the list. FBR needs the buyer's province on every invoice."
                    : "Pick from the list. Optional.",
                ListSource.Province, Width: 18),
            new OnboardingColumn("address", "Address", Requirement.Optional,
                "Full address. Printed on documents" + (provinceRequired ? " and sent to FBR." : "."),
                Width: 40),
            new OnboardingColumn("strn", "STRN", Requirement.Optional,
                "Sales tax registration number. Kept for Registered only; printed on bills and tax invoices.",
                Kind: ColumnKind.Identifier, Width: 18),
            new OnboardingColumn("phone", "Phone", Requirement.Optional,
                "Printed on documents.", Kind: ColumnKind.Identifier, Width: 18),
        };

        public static readonly IReadOnlyList<OnboardingSheet> Sheets = new List<OnboardingSheet>
        {
            new(OnboardingSheets.Customers, "Customers",
                "The businesses you sell to. FBR checks these details on every invoice.",
                "clients.manage.create",
                Party(provinceRequired: true, who: "customer").Concat(new[]
                {
                    new OnboardingColumn("sites", "Sites", Requirement.Optional,
                        "Delivery sites printed on challans and orders. Separate several with ; e.g. Karachi; Lahore.",
                        Width: 30),
                    new OnboardingColumn("contactPerson", "Contact Person", Requirement.Optional,
                        "Printed on quotations. Separate several with ;",
                        Width: 24),
                }).ToList()),

            new(OnboardingSheets.Items, "Items",
                "The goods or services you bill. FBR needs the HS code, unit and sale type on every line.",
                "itemtypes.manage.create",
                new List<OnboardingColumn>
                {
                    new("name", "Item Name", Requirement.Required,
                        "As it should print on bills. The same name may repeat only with a different HS code.",
                        Width: 34, Aliases: new[] { "name", "item" }),
                    new("hsCode", "HS Code", Requirement.Optional,
                        "8 digits with a dot, e.g. 8481.8090. Leave empty if unknown; the item cannot be filed with FBR until it has one.",
                        Kind: ColumnKind.Identifier, Width: 16),
                    new("unit", "Unit", Requirement.Optional,
                        "Unit of measure, e.g. Pcs or KG. Leave empty to take the unit FBR lists for the HS code.",
                        ListSource.Unit, Width: 18),
                    new("saleType", "Sale Type", Requirement.Optional,
                        "Pick from the list. Leave empty for Goods at standard rate (default).",
                        ListSource.SaleType, Width: 30),
                }),

            new(OnboardingSheets.Suppliers, "Suppliers",
                "The businesses you buy from. Printed on purchase bills and goods receipts.",
                "suppliers.manage.create",
                Party(provinceRequired: false, who: "supplier").ToList()),

            new(OnboardingSheets.OpeningStock, "Opening Stock",
                "What you hold on the day you start. One row per item.",
                "stock.opening.manage",
                new List<OnboardingColumn>
                {
                    new("itemName", "Item Name", Requirement.Required,
                        "Exactly as on the Items sheet, or as it already appears in Item Types.",
                        Width: 34, Aliases: new[] { "item", "name" }),
                    new("hsCode", "HS Code", Requirement.Optional,
                        "Only needed when two items share the same name.",
                        Kind: ColumnKind.Identifier, Width: 16),
                    new("quantity", "Quantity", Requirement.Required,
                        "Quantity on hand, more than 0.", Kind: ColumnKind.Number, Width: 14,
                        Aliases: new[] { "qty" }),
                    new("asOfDate", "As Of Date", Requirement.Required,
                        "The date the quantity was counted, e.g. 01-07-2026.",
                        Kind: ColumnKind.Date, Width: 16, Aliases: new[] { "date" }),
                    new("notes", "Notes", Requirement.Optional, "Anything worth keeping.", Width: 30),
                }),
        };

        public static OnboardingSheet? Find(string key) =>
            Sheets.FirstOrDefault(s => string.Equals(s.Key, key, StringComparison.OrdinalIgnoreCase));

        /// <summary>
        /// The sheet keys a request names, in import order, unknown ones dropped.
        /// Null / empty means every sheet.
        /// </summary>
        public static List<string> ParseSheetList(string? csv)
        {
            if (string.IsNullOrWhiteSpace(csv)) return OnboardingSheets.ImportOrder.ToList();
            var asked = csv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            return OnboardingSheets.ImportOrder
                .Where(k => asked.Any(a => string.Equals(a, k, StringComparison.OrdinalIgnoreCase)))
                .ToList();
        }
    }
}
