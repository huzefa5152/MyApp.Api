namespace MyApp.Api.Models
{
    public class ItemDescription
    {
        public int Id { get; set; }
        public string Name { get; set; } = "";

        // FBR digital-invoicing defaults. These are remembered per item name so users
        // don't need to re-enter HS Code / Sale Type / UOM every time they invoice
        // the same product. Populated the first time a user picks FBR fields on a bill.
        public string? HSCode { get; set; }
        public string? SaleType { get; set; }
        public int? FbrUOMId { get; set; }
        public string? UOM { get; set; }  // human description of the UOM

        // Favorites + usage tracking. Lets the UI show a curated subset of FBR items
        // (user-favorited OR most-frequently-used) as the default dropdown, instead
        // of making users search FBR's full 15k+ item catalog every time.
        public bool IsFavorite { get; set; }
        public int UsageCount { get; set; }
        public DateTime? LastUsedAt { get; set; }
    }
}
