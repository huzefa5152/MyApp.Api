namespace MyApp.Api.Models
{
    public class Company
    {
        public int Id { get; set; }
        public string Name { get; set; } = "";
        public string? BrandName { get; set; }
        public string? LogoPath { get; set; }
        public string? FullAddress { get; set; }
        public string? Phone { get; set; }
        public string? NTN { get; set; }
        public string? CNIC { get; set; }
        public string? STRN { get; set; }
        public int StartingChallanNumber { get; set; }
        public int CurrentChallanNumber { get; set; }
        public int StartingInvoiceNumber { get; set; }
        public int CurrentInvoiceNumber { get; set; }
        public string? InvoiceNumberPrefix { get; set; }

        // FBR Digital Invoicing
        public int? FbrProvinceCode { get; set; }
        public string? FbrBusinessActivity { get; set; }
        public string? FbrSector { get; set; }
        public string? FbrToken { get; set; }
        public string? FbrEnvironment { get; set; }

        // ── Per-company FBR defaults for new bills ──
        //
        // Instead of hardcoding "Goods at Standard Rate (default)" and
        // "Numbers, pieces, units" in the invoice service, each company
        // configures its own defaults. When the operator creates a new bill:
        //   • if an item line doesn't set SaleType, the company's
        //     FbrDefaultSaleType is used
        //   • if an item line doesn't set UOM, the company's
        //     FbrDefaultUOM is used
        //   • if the bill header doesn't set PaymentMode, we pick one of the
        //     two mode fields below based on buyer registration type
        //     (Registered → FbrDefaultPaymentModeRegistered,
        //      Unregistered → FbrDefaultPaymentModeUnregistered)
        //
        // All null → fall back to the built-in seed values so existing
        // companies keep working without a migration script.
        public string? FbrDefaultSaleType { get; set; }
        public string? FbrDefaultUOM { get; set; }
        public string? FbrDefaultPaymentModeRegistered { get; set; }
        public string? FbrDefaultPaymentModeUnregistered { get; set; }

        public List<DeliveryChallan> DeliveryChallans { get; set; } = new();
        public List<Client> Clients { get; set; } = new();
        public List<Invoice> Invoices { get; set; } = new();
    }
}
