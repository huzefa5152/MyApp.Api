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

        // ── Importer-oriented figures (2026-09-17) ─────────────────────────
        // An importer buys nothing on purchase bills — stock arrives through
        // opening stock and GD costing — so Total Purchases reads 0 and Net
        // (Sales − Purchases) merely restates Total Sales while looking like
        // profit. Meanwhile the two largest numbers in the business, stock and
        // debtors, were not on the dashboard at all. See
        // docs/superpowers/specs/2026-09-17-importer-dashboard-kpis-design.md.

        /// <summary>Sales excluding tax. <see cref="TotalSales"/> is the
        /// tax-INCLUSIVE GrandTotal, which is what made an operator compare it
        /// against an ex-tax stock sheet and find a gap nothing explained.</summary>
        public decimal TotalSalesExcludingTax { get; set; }

        /// <summary>Cost of the goods sold in the period, declared basis,
        /// from the same walk the ledger's monthly relief entries use.</summary>
        public decimal CostOfGoodsSold { get; set; }

        /// <summary>Breakage, count corrections and revaluations — NOT cost of
        /// goods sold, kept apart so gross margin stays honest.</summary>
        public decimal InventoryAdjustments { get; set; }

        /// <summary><see cref="TotalSalesExcludingTax"/> − <see cref="CostOfGoodsSold"/>.
        /// Reads near zero for a company that invoices at declared customs
        /// value; that is the honest declared-basis picture, not a fault.</summary>
        public decimal GrossProfit { get; set; }

        /// <summary>Gross profit as a percentage of ex-tax sales; null when
        /// there were no sales to divide by.</summary>
        public decimal? GrossMarginPercent { get; set; }

        /// <summary>What the goods on hand are worth right now (declared
        /// basis). Not period-scoped — stock is a position, not a flow.</summary>
        public decimal StockOnHandValue { get; set; }

        /// <summary>Outstanding receivables, and the overdue slice of them.</summary>
        public decimal ReceivablesTotal { get; set; }
        public decimal ReceivablesOverdue { get; set; }

        /// <summary>Everything owed, not just trade creditors: an importer has
        /// no suppliers on the books, so an AccountsPayable-only figure reads
        /// 0.00 and teaches the operator nothing.</summary>
        public decimal PayablesTotal { get; set; }
        public decimal PayablesTrade { get; set; }
        public decimal PayablesTax { get; set; }
        public decimal PayablesImportClearing { get; set; }

        /// <summary>Recoverable FROM the tax authority — input sales tax and
        /// advance income tax on imports. These are assets, not payables: an
        /// import's duties are paid at clearance and then credited back. Zero
        /// until a GD is recorded as a New Arrival, which is exactly when it
        /// should appear.</summary>
        public decimal RecoverableTaxTotal { get; set; }
        public decimal RecoverableInputTax { get; set; }
        public decimal RecoverableAdvanceIncomeTax { get; set; }

        // ── Which cards have anything to say ───────────────────────────────
        // One layout, cards hidden when their concept is empty for this
        // company. Chosen over two layouts because the only companies with
        // purchase bills were demo data — building a second arrangement for a
        // case no customer has is cost without benefit.

        /// <summary>False when the company has never raised a purchase bill, so
        /// Total Purchases and Net are hidden rather than shown as 0.</summary>
        public bool HasPurchases { get; set; }

        /// <summary>False when the company tracks no stock at all.</summary>
        public bool HasStock { get; set; }

        /// <summary>False when the company has no documents of any kind — a
        /// configured but not-yet-trading tenant, which gets an empty state
        /// instead of a wall of zeroes.</summary>
        public bool HasAnyActivity { get; set; }
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
