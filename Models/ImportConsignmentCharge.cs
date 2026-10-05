namespace MyApp.Api.Models
{
    /// <summary>
    /// A cost that belongs to a whole GD rather than one of its lines (2026-10-05,
    /// maintainer's decision): sea freight, the clearing agent's bill, wharfage,
    /// demurrage, port or container charges. It is spread over the GD's costed
    /// lines by assessed value INTO their landed cost -- the actual cost that
    /// margin and cost-of-goods reporting use -- and never into the declared
    /// value, the FBR figures or the GD's own duties.
    ///
    /// On a New Arrivals GD with the ledger on it is owed like the rest of the GD:
    /// <c>PostingService.PostImportConsignmentAsync</c> credits it to Import
    /// Clearing (so Settle can pay it) and debits the Inventory valuation reserve
    /// (declared value stays on Inventory; the higher landed cost narrows the gap).
    /// </summary>
    public class ImportConsignmentCharge
    {
        public int Id { get; set; }

        /// <summary>Plain column, no foreign key: the consignment already
        /// restricts on Company, and a second path into this table is the
        /// cascade SQL Server refuses.</summary>
        public int CompanyId { get; set; }

        public int ImportConsignmentId { get; set; }

        /// <summary><see cref="ImportChargeKinds"/>.</summary>
        public string Kind { get; set; } = ImportChargeKinds.Other;

        public decimal Amount { get; set; }
        public string? Description { get; set; }
        /// <summary>Who it is owed to -- the shipping line, the clearing agent.</summary>
        public string? PaidTo { get; set; }
        public DateTime ChargeDate { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        public ImportConsignment ImportConsignment { get; set; } = null!;
    }

    public static class ImportChargeKinds
    {
        public const string Freight = "freight";
        public const string Clearing = "clearing";
        public const string Wharfage = "wharfage";
        public const string Demurrage = "demurrage";
        public const string Port = "port";
        public const string Other = "other";

        public static readonly string[] All = { Freight, Clearing, Wharfage, Demurrage, Port, Other };

        public static string? Normalize(string? kind)
        {
            var k = (kind ?? "").Trim().ToLowerInvariant();
            return All.Contains(k) ? k : null;
        }
    }
}
