namespace MyApp.Api.Models
{
    public class FbrLookup
    {
        public int Id { get; set; }
        public string Category { get; set; } = "";
        public string Code { get; set; } = "";
        public string Label { get; set; } = "";
        public int SortOrder { get; set; }
        public bool IsActive { get; set; } = true;
    }
}
