namespace MyApp.Api.DTOs
{
    /// <summary>A letter of credit, with figures derived from the GDs shipped against it.</summary>
    public class ImportLcDto
    {
        public int Id { get; set; }
        public string LcNumber { get; set; } = "";
        public string? BankName { get; set; }
        public string? SupplierName { get; set; }
        public string Currency { get; set; } = "USD";
        public decimal ForeignAmount { get; set; }
        public decimal? ExchangeRate { get; set; }
        public DateTime OpenedOn { get; set; }
        public DateTime? ExpiresOn { get; set; }
        public string Status { get; set; } = "open";
        public string? Notes { get; set; }
        // Derived from the GDs linked to it.
        public int GdCount { get; set; }
        public decimal AssessedValue { get; set; }
        public decimal LandedCost { get; set; }
        public decimal Owed { get; set; }
        public decimal Settled { get; set; }
        public decimal Outstanding { get; set; }
        public List<ImportLcGdDto> Gds { get; set; } = new();
    }

    public class ImportLcGdDto
    {
        public int Id { get; set; }
        public string GdNumber { get; set; } = "";
        public DateTime GdDate { get; set; }
        public string? BlNumber { get; set; }
        public decimal AssessedValue { get; set; }
        public decimal LandedCost { get; set; }
        public decimal Owed { get; set; }
        public decimal Settled { get; set; }
    }

    public class ImportLcLinkDto
    {
        public int? LcId { get; set; }
        public string? BlNumber { get; set; }
    }
}
