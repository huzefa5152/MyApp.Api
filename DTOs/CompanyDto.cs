namespace MyApp.Api.DTOs
{
    public class CompanyDto
    {
        public int Id { get; set; } // Used for GET/PUT
        public string Name { get; set; } = string.Empty;
        public int StartingChallanNumber { get; set; }
        public int CurrentChallanNumber { get; set; }
    }
}
