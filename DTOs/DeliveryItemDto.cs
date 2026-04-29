namespace MyApp.Api.DTOs
{
    public class DeliveryItemDto
    {
        public int Id { get; set; }
        public int? ItemTypeId { get; set; }
        public string ItemTypeName { get; set; } = "";
        public string Description { get; set; } = "";
        // Decimal so fractional UOMs (KG, Liter, etc.) round-trip correctly.
        // The frontend formats with at most 4 decimal places (trailing zeros
        // stripped) so e.g. 12.5 displays as "12.5", 0.0004 as "0.0004",
        // 0.09 as "0.09" — never "0.0900".
        public decimal Quantity { get; set; }
        public string Unit { get; set; } = "";
    }
}
