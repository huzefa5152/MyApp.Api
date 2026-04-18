namespace MyApp.Api.DTOs
{
    public class ItemTypeDto
    {
        public int Id { get; set; }
        public string Name { get; set; } = "";

        // FBR Digital Invoicing metadata. A bill's line items inherit these
        // values from the ItemType they reference — so users don't need to
        // enter HS Code / Sale Type / UOM on every single bill.
        public string? HSCode { get; set; }
        public string? UOM { get; set; }
        public int? FbrUOMId { get; set; }
        public string? SaleType { get; set; }
        public string? FbrDescription { get; set; }

        public bool IsFavorite { get; set; }
        public int UsageCount { get; set; }
    }
}
