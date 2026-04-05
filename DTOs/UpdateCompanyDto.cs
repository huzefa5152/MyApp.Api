namespace MyApp.Api.DTOs
{
    public class UpdateCompanyDto
    {
        public string Name { get; set; } = string.Empty;
        public string? BrandName { get; set; }
        public string? FullAddress { get; set; }
        public string? Phone { get; set; }
        public string? NTN { get; set; }
        public string? STRN { get; set; }
        public string? LogoPath { get; set; }
        public int StartingChallanNumber { get; set; }
        public int StartingInvoiceNumber { get; set; }
    }
}
