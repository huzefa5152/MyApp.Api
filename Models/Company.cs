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

        // ── Purchase / Inventory module ──
        //
        // Inventory tracking is opt-in per company. While false, no
        // StockMovements are emitted by Invoice/PurchaseBill saves and the
        // stock guard on bill creation is silent. This lets existing
        // companies (Hakimi, Roshan) keep working unchanged until they're
        // ready to enter opening balances and turn it on.
        public bool InventoryTrackingEnabled { get; set; }

        // When InventoryTrackingEnabled = true and StockGuardHardBlock = true,
        // bill creation is REFUSED if any line would oversell stock. When
        // false (default), the operator gets a soft warning but can save
        // anyway — useful while they're still settling their purchase
        // discipline.
        public bool StockGuardHardBlock { get; set; }

        // Independent counters for the purchase side so purchase-bill numbers
        // don't collide with sales-invoice numbers. Same pattern as
        // CurrentInvoiceNumber / StartingInvoiceNumber.
        public int StartingPurchaseBillNumber { get; set; }
        public int CurrentPurchaseBillNumber { get; set; }
        public int StartingGoodsReceiptNumber { get; set; }
        public int CurrentGoodsReceiptNumber { get; set; }

        // ── Tenant isolation ──
        // When false (default), any authenticated user with the right
        // RBAC permission can access this company's data — preserves
        // the legacy "every user sees every company" behaviour Hakimi
        // and Roshan rely on. Flip to true on a SaaS tenant and only
        // users with an explicit UserCompany row can reach it. See
        // ICompanyAccessGuard.
        public bool IsTenantIsolated { get; set; }

        public List<DeliveryChallan> DeliveryChallans { get; set; } = new();
        public List<Client> Clients { get; set; } = new();
        public List<Supplier> Suppliers { get; set; } = new();
        public List<Invoice> Invoices { get; set; } = new();
        public List<PurchaseBill> PurchaseBills { get; set; } = new();
        public List<GoodsReceipt> GoodsReceipts { get; set; } = new();
    }
}
