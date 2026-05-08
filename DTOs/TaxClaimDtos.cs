namespace MyApp.Api.DTOs
{
    // ── Tax-claim DTOs (Phase B — Pakistan-compliance shape) ────────────
    //
    // Wire shape for /api/tax-claim/claim-summary. The endpoint takes
    // the full state of the bill the operator is currently editing
    // (HS-aggregated rows + bill date + GST rate) and returns a
    // per-HS claim summary using Pakistan's Sales Tax rules:
    //
    //   • Section 8A — purchases > 6 months old don't count
    //   • Section 8B — input claim ≤ 90% of output tax (period)
    //   • IRIS / STRIVe — only ReconciliationStatus ∈ Matched/Pending
    //   • Per-sale qty matching at weighted-average unit cost (not
    //     "claim the whole bank")
    //
    // Output is informational. The operator is never blocked from
    // saving — even when there's zero matching purchase. The UI surfaces
    // warnings so the operator can adjust purchases later.

    /// <summary>
    /// One row of the bill being edited, aggregated by HS Code at the
    /// frontend. The service uses the qty + value to compute per-HS
    /// matched amounts against the historical purchase bank.
    /// </summary>
    public class TaxClaimBillRow
    {
        public string HsCode { get; set; } = "";
        public string ItemTypeName { get; set; } = "";
        public decimal Qty { get; set; }
        public decimal Value { get; set; }
    }

    /// <summary>
    /// Period codes the panel can request. The default in the service
    /// when this is empty is "this-month" derived from the bill date —
    /// matches the Pakistani Sales Tax filing rhythm.
    /// </summary>
    public class TaxClaimSummaryRequest
    {
        public int CompanyId { get; set; }

        /// <summary>
        /// Date the bill is dated for. Drives the period boundaries
        /// (default = month containing this date) AND the Section 8A
        /// 6-month aging cutoff (purchases older than BillDate − 6m
        /// are excluded).
        /// </summary>
        public DateTime BillDate { get; set; }

        /// <summary>
        /// GST rate at the bill header. Used for output-tax math when
        /// per-line rate isn't stored separately. For mixed-rate bills
        /// this is approximate.
        /// </summary>
        public decimal BillGstRate { get; set; }

        /// <summary>
        /// HS-aggregated current bill state — qty + value per HS Code.
        /// </summary>
        public List<TaxClaimBillRow> BillRows { get; set; } = new();

        /// <summary>
        /// Optional period override:
        ///   "this-month" (default) | "last-month" | "this-quarter" |
        ///   "year-to-date" | "all-time"
        /// </summary>
        public string? PeriodCode { get; set; }
    }

    public class TaxClaimPeriod
    {
        public string Code { get; set; } = "";
        public string Label { get; set; } = "";
        public DateTime? From { get; set; }
        public DateTime? To { get; set; }
    }

    /// <summary>
    /// What the historical bank looks like for one HS Code under the
    /// current period and aging rules. "Bank" excludes purchases older
    /// than 6 months and excludes ManualOnly bills.
    /// </summary>
    public class HsBankSnapshot
    {
        public decimal PurchasedQty { get; set; }
        public decimal PurchasedValue { get; set; }
        public decimal PurchasedTax { get; set; }
        public decimal SoldQty { get; set; }
        public decimal SoldValue { get; set; }
        public decimal SoldTax { get; set; }

        // Net = max(0, purchases − prior sales). This is what's left
        // for THIS bill to consume.
        public decimal AvailableQty { get; set; }
        public decimal AvailableValue { get; set; }
        public decimal AvailableTax { get; set; }

        // Weighted-average unit numbers — drive the per-sale match.
        public decimal AvgUnitCost { get; set; }
        public decimal AvgUnitTax { get; set; }

        // Aging signal — how close is the oldest purchase to falling
        // out of the 6-month §8A window? Surface a warning when
        // anything ages out within 30 days.
        public DateTime? OldestPurchaseDate { get; set; }
        public bool ExpiringWithin30Days { get; set; }
    }

    /// <summary>
    /// Pending-but-not-yet-claimable purchases — bills with an IRN that
    /// haven't been reconciled in IRIS yet. Become claimable once the
    /// supplier files their return.
    /// </summary>
    public class HsPendingSnapshot
    {
        public int BillCount { get; set; }
        public decimal Qty { get; set; }
        public decimal Value { get; set; }
        public decimal Tax { get; set; }
    }

    /// <summary>
    /// Manual-only purchases — bills entered without a SupplierIRN
    /// (ReconciliationStatus = "ManualOnly"). Inventory IS counted on
    /// the Stock Dashboard but NEVER claimable for input tax until the
    /// operator backfills the IRN. Surfaced separately so the operator
    /// can see what they're missing without confusion.
    /// </summary>
    public class HsManualOnlySnapshot
    {
        public int BillCount { get; set; }
        public decimal Qty { get; set; }
        public decimal Value { get; set; }
        public decimal Tax { get; set; }     // what would be claimable IF reconciled
    }

    /// <summary>
    /// Disputed purchases — IRIS actively rejected the supplier match
    /// (ReconciliationStatus = "Disputed"). Worse than Pending: requires
    /// the operator to re-issue the bill or chase the supplier. Never
    /// claimable.
    /// </summary>
    public class HsDisputedSnapshot
    {
        public int BillCount { get; set; }
        public decimal Qty { get; set; }
        public decimal Value { get; set; }
        public decimal Tax { get; set; }
    }

    /// <summary>
    /// What this specific bill claims for one HS Code — the per-sale
    /// matched portion, NOT the whole bank.
    /// </summary>
    public class HsBillMatch
    {
        public decimal MatchedQty { get; set; }      // min(billQty, availableQty)
        public decimal MatchedInputTax { get; set; } // matchedQty × avgUnitTax
        public decimal UnmatchedQty { get; set; }    // billQty − matchedQty (no input backing)
        public decimal OutputTax { get; set; }       // billValue × billGstRate / 100
    }

    public class HsClaimRow
    {
        public string HsCode { get; set; } = "";
        public string ItemTypeName { get; set; } = "";
        public TaxClaimBillRow Bill { get; set; } = new();
        public HsBankSnapshot Bank { get; set; } = new();
        public HsPendingSnapshot Pending { get; set; } = new();
        public HsManualOnlySnapshot ManualOnly { get; set; } = new();
        public HsDisputedSnapshot Disputed { get; set; } = new();
        public HsBillMatch Match { get; set; } = new();
        // good          — billQty fits within availableQty
        // headroom      — billQty < availableQty (claim more)
        // shortfall     — billQty > availableQty (no input for the overflow)
        // no-purchase   — zero purchases of any kind in the period
        // pending-only  — purchases exist but all are not-yet-IRIS-matched
        // manual-only   — purchases exist but all are ManualOnly (no IRN)
        // disputed-only — purchases exist but all are Disputed by IRIS
        public string Status { get; set; } = "";
    }

    public class TaxClaimTotals
    {
        public decimal BillOutputTax { get; set; }
        public decimal MatchedInputTax { get; set; }
        public decimal Section8BCap { get; set; }
        public decimal ClaimableThisBill { get; set; }     // min(matched, 8B cap)
        public decimal Section8BCarryForward { get; set; } // matched − 8B cap (≥ 0)
        public decimal CarryForwardFromPrior { get; set; }
        public decimal NetNewTax { get; set; }             // billOutput − claimable
        public bool Section8BCapApplied { get; set; }
    }

    public class TaxClaimSummaryResponse
    {
        public int CompanyId { get; set; }
        public DateTime ComputedAt { get; set; }
        public TaxClaimPeriod Period { get; set; } = new();
        public List<HsClaimRow> Rows { get; set; } = new();
        public TaxClaimTotals Totals { get; set; } = new();
        public List<string> Warnings { get; set; } = new();
        // Echo of the compliance config used to compute this snapshot —
        // lets the UI show "Computed under: §8A 6mo / §8B 90% / IRIS
        // (Matched + Pending)" so operators trust the numbers.
        public ComplianceConfig Config { get; set; } = new();
    }

    public class ComplianceConfig
    {
        public int Section8BCapPercent { get; set; }
        public int AgingMonths { get; set; }
        public List<string> ClaimableReconciliationStatuses { get; set; } = new();
    }
}
