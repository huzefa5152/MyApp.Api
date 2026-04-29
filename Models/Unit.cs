namespace MyApp.Api.Models
{
    public class Unit
    {
        public int Id { get; set; }
        public string Name { get; set; } = "";

        /// <summary>
        /// When true, the bill / challan / purchase forms render the
        /// Quantity input with step="0.0001" so the operator can type
        /// fractional values like 12.5 KG or 0.0004 Carat. When false
        /// (default), the input is locked to whole numbers — a "2.5 Pcs"
        /// row is nonsense and is rejected at both the form level and the
        /// server. Configurable per-unit via the Units admin page so
        /// operators can flip the flag without a code release.
        /// </summary>
        public bool AllowsDecimalQuantity { get; set; }
    }
}
