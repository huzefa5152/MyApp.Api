namespace MyApp.Api.DTOs
{
    /// <summary>Wire shape for a company division. Used for read + create/update
    /// (Id ignored on create; CompanyId comes from the route).</summary>
    public class DivisionDto
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public string Name { get; set; } = "";
    }
}
