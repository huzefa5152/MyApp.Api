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
        public string? InvoiceNumberPrefix { get; set; }
        public int? FbrProvinceCode { get; set; }
        public string? FbrBusinessActivity { get; set; }
        public string? FbrSector { get; set; }
        public string? FbrToken { get; set; }
        public string? FbrEnvironment { get; set; }
    }
}
