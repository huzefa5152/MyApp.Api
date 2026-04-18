namespace MyApp.Api.DTOs
{
    public class CreateItemDto
    {
        public string Name { get; set; } = "";
    }

    /// <summary>
    /// Upsert payload for remembered FBR defaults per item description.
    /// Only non-null / non-empty values are persisted — allowing partial updates.
    /// </summary>
    public class SaveItemFbrDefaultsDto
    {
        public string Name { get; set; } = "";
        public string? HSCode { get; set; }
        public string? SaleType { get; set; }
        public int? FbrUOMId { get; set; }
        public string? UOM { get; set; }
    }

    public class ToggleFavoriteDto
    {
        public bool IsFavorite { get; set; }
    }
}
