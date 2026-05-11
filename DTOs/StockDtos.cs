namespace MyApp.Api.DTOs
{
    /// <summary>
    /// One row on the Stock Dashboard: an item from the catalog with its
    /// current on-hand for the selected company and the most recent
    /// movement date. Drives the at-a-glance "what do we have?" view.
    /// </summary>
    public class StockOnHandRowDto
    {
        public int ItemTypeId { get; set; }
        public string ItemTypeName { get; set; } = "";
        public string? HSCode { get; set; }
        public string? UOM { get; set; }
        // 2026-05-12: promoted to decimal alongside StockMovement.Quantity
        // and OpeningStockBalance.Quantity so fractional UOMs (KG, Liter,
        // Carat) display without truncation.
        public decimal OnHand { get; set; }
        public decimal OpeningBalance { get; set; }
        public decimal TotalIn { get; set; }
        public decimal TotalOut { get; set; }
        public DateTime? LastMovementAt { get; set; }
    }

    /// <summary>
    /// One row on the Stock Movements page — a flat audit feed of every
    /// change to inventory. Filterable by item, source type, date range.
    /// </summary>
    public class StockMovementRowDto
    {
        public int Id { get; set; }
        public int ItemTypeId { get; set; }
        public string ItemTypeName { get; set; } = "";
        public string Direction { get; set; } = ""; // "In" / "Out"
        public decimal Quantity { get; set; }
        public string SourceType { get; set; } = ""; // PurchaseBill, Invoice, OpeningBalance, ...
        public int? SourceId { get; set; }
        public DateTime MovementDate { get; set; }
        public string? Notes { get; set; }
    }

    public class OpeningStockBalanceDto
    {
        public int? Id { get; set; }
        public int CompanyId { get; set; }
        public int ItemTypeId { get; set; }
        public string ItemTypeName { get; set; } = "";
        public decimal Quantity { get; set; }
        public DateTime AsOfDate { get; set; }
        public string? Notes { get; set; }
    }

    public class UpsertOpeningBalanceDto
    {
        public int CompanyId { get; set; }
        public int ItemTypeId { get; set; }
        public decimal Quantity { get; set; }
        public DateTime AsOfDate { get; set; }
        public string? Notes { get; set; }
    }

    public class CreateStockAdjustmentDto
    {
        public int CompanyId { get; set; }
        public int ItemTypeId { get; set; }
        /// <summary>Signed quantity — positive = adjust up, negative = down.</summary>
        public decimal Delta { get; set; }
        public DateTime MovementDate { get; set; }
        public string? Notes { get; set; }
    }
}
