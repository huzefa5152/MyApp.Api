namespace MyApp.Api.DTOs
{
    /// <summary>A customer document a purchase serves: "order", "challan" or "bill".</summary>
    public class DemandTagDto
    {
        public string Kind { get; set; } = "";
        public int DocumentId { get; set; }
        public int Number { get; set; }
        public string ClientName { get; set; } = "";
    }

    /// <summary>One customer-document line a purchase row buys, and how much of it.</summary>
    public class PurchaseItemSourceDto
    {
        public string Kind { get; set; } = "";
        public int LineId { get; set; }
        public decimal Quantity { get; set; }
        /// <summary>Read only: the demand this line belongs to (as the picker's trailKey).</summary>
        public string? TrailKey { get; set; }
    }

    public class AwaitingLinesQuery
    {
        public int? SupplierId { get; set; }
        public bool AllSuppliers { get; set; }
        public string? Search { get; set; }
        public string GroupBy { get; set; } = "latest";
        public int? ExcludeBillId { get; set; }
        public string? ForKind { get; set; }
        public int? ForId { get; set; }
    }

    /// <summary>A customer document (or "No sales order" / "Not billed yet") with lines left to buy.</summary>
    public class AwaitingCardDto
    {
        public string Kind { get; set; } = "";
        public int? DocumentId { get; set; }
        public int? Number { get; set; }
        public string Title { get; set; } = "";
        public string ClientName { get; set; } = "";
        public DateTime? Date { get; set; }
        public string? PoNumber { get; set; }
        public List<DemandTagDto> From { get; set; } = new();
        public List<AwaitingLineDto> Lines { get; set; } = new();
    }

    public class AwaitingLineDto
    {
        public string Kind { get; set; } = "";
        public int LineId { get; set; }
        public string TrailKey { get; set; } = "";
        public string Stage { get; set; } = "";
        public string Description { get; set; } = "";
        public int? ItemTypeId { get; set; }
        public string? ItemTypeName { get; set; }
        public int? NonInventoryItemId { get; set; }
        public string Unit { get; set; } = "";
        public decimal Ordered { get; set; }
        public decimal Delivered { get; set; }
        public decimal Billed { get; set; }
        public decimal Bought { get; set; }
        public decimal Left { get; set; }
        public decimal? Cost { get; set; }
        public int? PlannedSupplierId { get; set; }
        public string? PlannedSupplierName { get; set; }
        public List<DemandTagDto> Trail { get; set; } = new();
    }
}
