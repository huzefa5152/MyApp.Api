namespace MyApp.Api.Models
{
    /// <summary>
    /// A letter of credit (or contract / advance payment) a company opened with
    /// its bank to pay a foreign supplier (2026-10-05). The GDs that cleared
    /// goods shipped against it point at it (<see cref="ImportConsignment.ImportLcId"/>),
    /// so the LC screen answers what an importer asks of an LC: how much of it
    /// has shipped, what those goods cost landed, and what is still owed on them.
    /// Record-keeping only -- nothing is posted to the ledger from here.
    /// </summary>
    public class ImportLetterOfCredit
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public string LcNumber { get; set; } = "";
        public string? BankName { get; set; }
        public string? SupplierName { get; set; }
        /// <summary>The LC's own currency, e.g. USD, CNY.</summary>
        public string Currency { get; set; } = "USD";
        public decimal ForeignAmount { get; set; }
        /// <summary>Optional PKR per unit of <see cref="Currency"/> when opened.</summary>
        public decimal? ExchangeRate { get; set; }
        public DateTime OpenedOn { get; set; }
        public DateTime? ExpiresOn { get; set; }
        /// <summary>open | closed</summary>
        public string Status { get; set; } = "open";
        public string? Notes { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        public Company Company { get; set; } = null!;
    }
}
