namespace MyApp.Api.Models.Accounting
{
    /// <summary>
    /// A "New Group" in the Chart of Accounts — a structural container that
    /// holds accounts and sub-groups, on either the Balance Sheet or the P&amp;L
    /// (design §4). Multi-level via <see cref="ParentGroupId"/>. The five
    /// statement-level groups (Assets / Liabilities / Equity / Income /
    /// Expenses) are seeded as <see cref="IsSystem"/> and can't be deleted.
    /// Order within a parent is operator-controlled (<see cref="Position"/>).
    /// </summary>
    public class AccountGroup
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public string Name { get; set; } = "";
        public FinancialStatement Statement { get; set; }

        /// <summary>Parent group for nesting; null = a statement-level group.</summary>
        public int? ParentGroupId { get; set; }

        /// <summary>Manual drag-order within the parent (not derived from a code).</summary>
        public int Position { get; set; }

        /// <summary>True for the seeded statement-level groups — protected from delete.</summary>
        public bool IsSystem { get; set; }

        /// <summary>Source-system key for imports (legacy AccountCode), so an ETL
        /// run is idempotent and traceable. Null for hand-created groups.</summary>
        public string? ExternalRef { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Navigation
        public Company Company { get; set; } = null!;
        public AccountGroup? ParentGroup { get; set; }
    }
}
