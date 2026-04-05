namespace MyApp.Api.DTOs
{
    public class CompanyDto
    {
        public int Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public string? BrandName { get; set; }
        public string? LogoPath { get; set; }
        public string? FullAddress { get; set; }
        public string? Phone { get; set; }
        public string? NTN { get; set; }
        public string? STRN { get; set; }
        public int StartingChallanNumber { get; set; }
        public int CurrentChallanNumber { get; set; }
        public int StartingInvoiceNumber { get; set; }
        public int CurrentInvoiceNumber { get; set; }
        public bool HasChallans { get; set; }
        public bool HasInvoices { get; set; }
    }
}
