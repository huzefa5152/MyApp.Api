namespace MyApp.Api.Helpers
{
    /// <summary>
    /// The closed vocabulary of the Copy Document feature: which document types
    /// can be copied, which destinations each source may be copied into, and the
    /// permission keys that gate reading a source and creating a destination.
    ///
    /// Type strings match <see cref="AttachmentEntityTypes"/> so one vocabulary
    /// covers both features — note that a Bill, an Invoice and a Credit/Debit
    /// Note are all rows of the single <see cref="Models.Invoice"/> entity, so
    /// they share the <see cref="Invoice"/> type here too.
    ///
    /// The conversion matrix below only enables pairs that make business sense
    /// AND already have a supported path in the system; everything else is
    /// deliberately absent:
    ///   • Sales Quote → Challan / Bill — a quote becomes an order first.
    ///   • Delivery Challan → Bill — owned by the billed-once challan flow
    ///     (<c>POST /api/invoices</c> with challanIds); copying there would
    ///     let the same delivery be billed twice.
    ///   • Anything crossing the sales/purchase boundary — the only sanctioned
    ///     crossing is the specialised "Purchase Against Sale Bill" procurement
    ///     flow, which is a procurement calculation, not a copy.
    /// </summary>
    public static class DocumentCopyTypes
    {
        public const string SalesQuote = "SalesQuote";
        public const string SalesOrder = "SalesOrder";
        public const string DeliveryChallan = "DeliveryChallan";
        /// <summary>A row of the Invoice entity — shown as "Bill" in the UI.</summary>
        public const string Invoice = "Invoice";
        public const string PurchaseBill = "PurchaseBill";
        public const string GoodsReceipt = "GoodsReceipt";

        public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal)
        {
            SalesQuote, SalesOrder, DeliveryChallan, Invoice, PurchaseBill, GoodsReceipt
        };

        private static readonly IReadOnlyDictionary<string, string[]> Matrix =
            new Dictionary<string, string[]>(StringComparer.Ordinal)
            {
                [SalesQuote]      = new[] { SalesQuote, SalesOrder },
                [SalesOrder]      = new[] { SalesOrder, DeliveryChallan, Invoice },
                [DeliveryChallan] = new[] { DeliveryChallan },
                [Invoice]         = new[] { Invoice },
                [PurchaseBill]    = new[] { PurchaseBill, GoodsReceipt },
                [GoodsReceipt]    = new[] { GoodsReceipt, PurchaseBill },
            };

        private static readonly IReadOnlyDictionary<string, string> Labels =
            new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [SalesQuote]      = "Sales Quote",
                [SalesOrder]      = "Sales Order",
                [DeliveryChallan] = "Delivery Challan",
                [Invoice]         = "Bill",
                [PurchaseBill]    = "Purchase Bill",
                [GoodsReceipt]    = "Goods Receipt",
            };

        // Creating a copied bill goes through the standalone-bill path (a copy
        // never inherits the source's delivery challans — those are already
        // billed), so the standalone key is the one that gates it.
        private static readonly IReadOnlyDictionary<string, string> CreateKeys =
            new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [SalesQuote]      = "salesquotes.manage.create",
                [SalesOrder]      = "salesorders.manage.create",
                [DeliveryChallan] = "challans.manage.create",
                [Invoice]         = "bills.manage.create.standalone",
                [PurchaseBill]    = "purchasebills.manage.create",
                [GoodsReceipt]    = "goodsreceipts.manage.create",
            };

        // Reading the source. Bills are listed under either key (the Bills tab
        // and the Invoices tab are two views of one entity), so holding either
        // is enough — same rule as [HasAnyPermission] on the listing endpoint.
        private static readonly IReadOnlyDictionary<string, string[]> ViewKeys =
            new Dictionary<string, string[]>(StringComparer.Ordinal)
            {
                [SalesQuote]      = new[] { "salesquotes.list.view" },
                [SalesOrder]      = new[] { "salesorders.list.view" },
                [DeliveryChallan] = new[] { "challans.list.view" },
                [Invoice]         = new[] { "bills.list.view", "invoices.list.view" },
                [PurchaseBill]    = new[] { "purchasebills.list.view" },
                [GoodsReceipt]    = new[] { "goodsreceipts.list.view" },
            };

        /// <summary>
        /// Returns the canonical (correctly-cased) type when the supplied value
        /// matches one of the copyable types case-insensitively; otherwise null.
        /// </summary>
        public static string? Canonical(string? type)
        {
            if (string.IsNullOrWhiteSpace(type)) return null;
            var trimmed = type.Trim();
            foreach (var t in All)
                if (string.Equals(t, trimmed, StringComparison.OrdinalIgnoreCase))
                    return t;
            return null;
        }

        public static bool IsValid(string? type) => Canonical(type) != null;

        /// <summary>Human-readable name for messages and the copy dialog.</summary>
        public static string Label(string type) => Labels.TryGetValue(type, out var l) ? l : type;

        /// <summary>Destination types this source may be copied into, itself first.</summary>
        public static IReadOnlyList<string> TargetsFor(string sourceType) =>
            Matrix.TryGetValue(sourceType, out var t) ? t : Array.Empty<string>();

        public static bool IsSupported(string sourceType, string destinationType) =>
            TargetsFor(sourceType).Contains(destinationType, StringComparer.Ordinal);

        /// <summary>Permission required to create a document of this type.</summary>
        public static string CreatePermission(string type) => CreateKeys[type];

        /// <summary>Permissions that allow reading a source of this type (ANY of).</summary>
        public static IReadOnlyList<string> ViewPermissions(string type) => ViewKeys[type];
    }
}
