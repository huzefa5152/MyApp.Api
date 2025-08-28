namespace MyApp.Api.DTOs
{
    public class UpdateCompanyDto
    {
        public string Name { get; set; } = string.Empty;
        public int StartingChallanNumber { get; set; }
        public int CurrentChallanNumber { get; set; }
    }
}
