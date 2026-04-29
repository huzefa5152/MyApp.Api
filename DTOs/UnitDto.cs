namespace MyApp.Api.DTOs
{
    /// <summary>
    /// Surfaces the AllowsDecimalQuantity flag to the frontend so quantity
    /// inputs and read-only displays can react to the unit choice without
    /// hard-coding a list of "decimal" UOMs in the React layer. Returned
    /// from /api/units (admin-tier list) and /api/lookup/units (search).
    /// </summary>
    public class UnitDto
    {
        public int Id { get; set; }
        public string Name { get; set; } = "";
        public bool AllowsDecimalQuantity { get; set; }
    }
}
