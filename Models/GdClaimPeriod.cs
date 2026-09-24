namespace MyApp.Api.Models
{
    /// <summary>The filed input-tax period for one company's customs declaration.
    /// It is entered from the return, never inferred from the GD date.</summary>
    public class GdClaimPeriod
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public string GdNumber { get; set; } = "";
        /// <summary>First day of the claimed month, or null when not yet known.</summary>
        public DateTime ClaimMonth { get; set; }
    }
}
