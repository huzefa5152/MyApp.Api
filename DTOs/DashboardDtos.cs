namespace MyApp.Api.DTOs
{
    // ── Dashboard KPI DTOs ─────────────────────────────────────────────
    //
    // Wire shape for GET /api/dashboard/kpis. Every section is nullable
    // because the controller populates only the sections the caller has
    // permission for — clients that lack `dashboard.kpi.sales.view` get
    // back `sales: null` and the page hides that block.
    //
    // Design decisions worth knowing:
    //
    //   • One endpoint, not five. Saves four round-trips and lets the
    //     server fan out the queries in parallel against a single
    //     AppDbContext.
    //
    //   • Period vs trend separation. The `Period` block on each KPI is
    //     filtered by the operator's chosen range (this-month etc).
    //     Trend arrays always show the last 12 months regardless of the
    //     range — gives a stable visual axis the operator's brain can
    //     calibrate against.
    //
    //   • All money in PKR major units (no paisa). DB stores
    //     decimal(18,2); we round on the way out for display.

    public class DashboardPeriod
    {
        public string Code { get; set; } = "";       // "this-month", "this-week", etc
        public string Label { get; set; } = "";      // "This Month"
        public DateTime? From { get; set; }          // null when code = "all-time"
        public DateTime? To { get; set; }
        // For delta computation — the matching previous period of the
        // same length. Null when range is all-time (no prior period to
        // compare against).
        public DateTime? PreviousFrom { get; set; }
        public DateTime? PreviousTo { get; set; }
    }

    public class DashboardHeroKpis
    {
        // Period values
        public decimal TotalSales { get; set; }
        public decimal TotalPurchases { get; set; }
        public decimal Net { get; set; }              // Sales − Purchases
        public decimal GstOutput { get; set; }        // tax we collected (sales)
        public decimal GstInput { get; set; }         // tax we paid (purchases)
        public decimal GstNet { get; set; }           // Output − Input (what we owe)

        // Previous-period values for delta. Null when range is all-time
        // (no previous period exists). Frontend hides the delta arrows
        // when these are null.
        public decimal? TotalSalesPrev { get; set; }
        public decimal? TotalPurchasesPrev { get; set; }
        public decimal? NetPrev { get; set; }
        public decimal? GstNetPrev { get; set; }
    }

    public class DashboardTrendPoint
    {
        public string Month { get; set; } = "";       // "2025-06" — sortable
        public string Label { get; set; } = "";       // "Jun 25" — display
        public decimal Value { get; set; }
    }

    public class DashboardTopEntity
    {
        public int Id { get; set; }
        public string Name { get; set; } = "";
        public decimal Value { get; set; }            // money or count, depends on context
        public int Count { get; set; }
    }

    public class DashboardRecentBill
    {
        public int Id { get; set; }
        public int Number { get; set; }
        public DateTime Date { get; set; }
        public string CounterpartyName { get; set; } = ""; // client (for sales) or supplier (for purchases)
        public decimal GrandTotal { get; set; }
        public string? Status { get; set; }           // FBR submit status / reconciliation status
    }

    public class DashboardSalesKpis
    {
        public decimal TotalSales { get; set; }
        public int InvoiceCount { get; set; }
        public decimal AverageInvoiceValue { get; set; }
        public List<DashboardTrendPoint> Trend12m { get; set; } = new();
        public List<DashboardTopEntity> TopClients { get; set; } = new();
        public List<DashboardRecentBill> RecentInvoices { get; set; } = new();
    }

    public class DashboardPurchaseKpis
    {
        public decimal TotalPurchases { get; set; }
        public int BillCount { get; set; }
        public decimal AverageBillValue { get; set; }
        public List<DashboardTrendPoint> Trend12m { get; set; } = new();
        public List<DashboardTopEntity> TopSuppliers { get; set; } = new();
        public List<DashboardRecentBill> RecentBills { get; set; } = new();
    }

    /// <summary>What customers owe, or what is owed to suppliers, as at today -
    /// a point-in-time balance, not a period figure. Taken from the aged
    /// report (<c>GeneralLedgerService.BuildAgingAsync</c>), so it is the
    /// Receivable / Payable Aging report's own total. The aging is not
    /// division-scoped, so it is returned only to a caller with no division
    /// restriction.</summary>
    public class DashboardBalancesKpis
    {
        public DateTime AsOf { get; set; }
        public decimal Total { get; set; }
        /// <summary>Past its due date (or its document date when none is set).</summary>
        public decimal Overdue { get; set; }
        public decimal Over90 { get; set; }
        public int PartyCount { get; set; }
        public int OverduePartyCount { get; set; }
        public List<DashboardBalanceRow> Top { get; set; } = new();
    }

    public class DashboardBalanceRow
    {
        public int Id { get; set; }
        public string Name { get; set; } = "";
        public decimal Total { get; set; }
        public decimal Overdue { get; set; }
        public int OpenDocuments { get; set; }
    }

    /// <summary>Money that actually moved in the period - receipts from
    /// customers and payments to suppliers, voided and bounced left out (the
    /// registers' rule). Cash movement, not profit.</summary>
    public class DashboardCashKpis
    {
        public decimal Collections { get; set; }
        public int CollectionCount { get; set; }
        public decimal? CollectionsPrev { get; set; }
        public decimal Payments { get; set; }
        public int PaymentCount { get; set; }
        public decimal? PaymentsPrev { get; set; }
        /// <summary>False when the caller can see only one side.</summary>
        public bool HasCollections { get; set; }
        public bool HasPayments { get; set; }
    }

    /// <summary>Open work - documents waiting on the operator, whatever the period.</summary>
    public class DashboardWorkKpis
    {
        /// <summary>Challans that can be billed now (<c>ChallanBillingRules</c>).</summary>
        public int ChallansAwaitingBilling { get; set; }
        public DateTime? OldestAwaitingBillingDate { get; set; }
        /// <summary>Unbilled challans blocked on missing FBR setup - never billable.</summary>
        public int ChallansSetupRequired { get; set; }

        /// <summary>Sales orders still Open (an order closes itself once fully
        /// delivered). Null when the caller cannot list sales orders.</summary>
        public int? OpenSalesOrders { get; set; }
        public DateTime? OldestOpenOrderDate { get; set; }

        /// <summary>Quotes not yet taken into an order and not past their
        /// validity - the quote list's "Active". Null without quote access.</summary>
        public int? ActiveQuotes { get; set; }
        public decimal ActiveQuotesValue { get; set; }
        public int QuotesExpiringSoon { get; set; }
    }

    public class DashboardFbrKpis
    {
        // Submission funnel — counts within the selected period.
        public int PendingSubmission { get; set; }    // bills not yet validated/submitted
        public int Validated { get; set; }            // dry-run passed, not submitted
        public int Submitted { get; set; }            // posted to FBR with IRN
        public int Failed { get; set; }               // validation/submit error
        public int Excluded { get; set; }             // operator marked "skip bulk" — visible to flag

        // Reconciliation against Annexure-A imports / manual entries.
        public int ReconciliationPending { get; set; }
        public int ReconciliationMatched { get; set; }
        public int ReconciliationDisputed { get; set; }
    }

    public class DashboardInventoryKpis
    {
        // Total estimated stock value at cost = sum over (item, qty on
        // hand × average unit cost from purchase history). Computed at
        // request time; cheap because purchase qtys aggregate per item.
        public decimal TotalStockValue { get; set; }
        public int TrackedItemCount { get; set; }
        public int LowStockItemCount { get; set; }    // qty <= 0 or under threshold

        public List<DashboardTopEntity> TopItemsByMovement { get; set; } = new();
        public List<DashboardRecentMovement> RecentMovements { get; set; } = new();
    }

    public class DashboardRecentMovement
    {
        public int Id { get; set; }
        public DateTime Date { get; set; }
        public string ItemTypeName { get; set; } = "";
        public string Direction { get; set; } = "";   // "In" or "Out"
        // 2026-05-12: decimal alongside StockMovement.Quantity promotion.
        public decimal Quantity { get; set; }
        public string SourceType { get; set; } = ""; // PurchaseBill / Invoice / Adjustment etc
    }

    public class DashboardKpisResponse
    {
        public int CompanyId { get; set; }
        public string CompanyName { get; set; } = "";
        public DashboardPeriod Period { get; set; } = new();

        // Permission-shaped — null when caller lacks the matching
        // dashboard.kpi.*.view permission. Page renders only what's
        // populated.
        public DashboardHeroKpis? Hero { get; set; }
        public DashboardSalesKpis? Sales { get; set; }
        public DashboardPurchaseKpis? Purchases { get; set; }
        public DashboardFbrKpis? Fbr { get; set; }
        public DashboardInventoryKpis? Inventory { get; set; }

        // Receivables need the sales KPI permission, payables the purchases
        // one, and both an unrestricted division scope.
        public DashboardBalancesKpis? Receivables { get; set; }
        public DashboardBalancesKpis? Payables { get; set; }
        public DashboardCashKpis? Cash { get; set; }
        public DashboardWorkKpis? Work { get; set; }

        // Tells the page which sections the user CAN see (so it can
        // decide between "show welcome banner" vs "render empty
        // dashboard with all sections hidden"). Mirrors the Hero/Sales/
        // ... nullability above but is easier for the frontend to read.
        public DashboardPermissionFlags Permissions { get; set; } = new();
    }

    public class DashboardPermissionFlags
    {
        public bool CanViewSales { get; set; }
        public bool CanViewPurchases { get; set; }
        public bool CanViewFbr { get; set; }
        public bool CanViewInventory { get; set; }

        // Convenience — true when at least one .kpi.* perm is held.
        // Page uses this to decide between "welcome banner only" and
        // "render the dashboard".
        public bool HasAnyKpi =>
            CanViewSales || CanViewPurchases || CanViewFbr || CanViewInventory;
    }
}
