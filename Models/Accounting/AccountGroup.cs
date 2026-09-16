namespace MyApp.Api.Models.Accounting
{
    /// <summary>
    /// A structural container in the Chart of Accounts — it holds accounts and
    /// sub-groups, on either the Balance Sheet or the P&amp;L. Multi-level via
    /// <see cref="ParentGroupId"/>. The statement-level groups (Assets /
    /// Liabilities / Equity / Income / Cost of Sales / Expenses) are seeded as
    /// <see cref="IsSystem"/> and can't be renamed or deleted. Order within a
    /// parent is operator-controlled (<see cref="Position"/>) rather than derived
    /// from a code, so a chart can be arranged the way its owner reads it.
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

        /// <summary>True for the seeded statement-level groups — protected from
        /// rename and delete.</summary>
        public bool IsSystem { get; set; }

        /// <summary>Stable source key ("seed:*" for the preset, a legacy account
        /// code for an import) so re-running a seed or an import upserts instead
        /// of duplicating. Null for hand-created groups.</summary>
        public string? ExternalRef { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Navigation
        public Company Company { get; set; } = null!;
        public AccountGroup? ParentGroup { get; set; }
    }
}
