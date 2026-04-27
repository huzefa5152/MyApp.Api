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
        public int OnHand { get; set; }
        public int OpeningBalance { get; set; }
        public int TotalIn { get; set; }
        public int TotalOut { get; set; }
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
        public int Quantity { get; set; }
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
        public int Quantity { get; set; }
        public DateTime AsOfDate { get; set; }
        public string? Notes { get; set; }
    }

    public class UpsertOpeningBalanceDto
    {
        public int CompanyId { get; set; }
        public int ItemTypeId { get; set; }
        public int Quantity { get; set; }
        public DateTime AsOfDate { get; set; }
        public string? Notes { get; set; }
    }

    public class CreateStockAdjustmentDto
    {
        public int CompanyId { get; set; }
        public int ItemTypeId { get; set; }
        /// <summary>Signed quantity — positive = adjust up, negative = down.</summary>
        public int Delta { get; set; }
        public DateTime MovementDate { get; set; }
        public string? Notes { get; set; }
    }
}
