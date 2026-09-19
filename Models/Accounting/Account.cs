namespace MyApp.Api.Models.Accounting
{
    /// <summary>
    /// One account in the Chart of Accounts — the dimension a posting lands on.
    /// A regular account is posted to directly; a control account
    /// (<see cref="IsControlAccount"/> + <see cref="ControlType"/>) is fed by a
    /// subledger (Client = A/R, Supplier = A/P, ItemType/stock = Inventory, bank
    /// records = Bank &amp; Cash) or reserved for a posting role, and must NOT be
    /// posted to by hand or deleted.
    ///
    /// Names legitimately repeat, so there is no unique-name index; an optional
    /// <see cref="Code"/> is unique per company when present. Every account
    /// belongs to one <see cref="AccountGroup"/>, and the group carries the
    /// statement it reports under.
    /// </summary>
    public class Account
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public string Name { get; set; } = "";

        /// <summary>Optional account number/code — unique per company when set.</summary>
        public string? Code { get; set; }

        public int AccountGroupId { get; set; }
        public AccountType AccountType { get; set; }

        /// <summary>Cash-flow class (Balance Sheet accounts only).</summary>
        public CashFlowClass? CashFlowClass { get; set; }

        /// <summary>Opening balance and which side it sits on. decimal(19,4) to
        /// carry GL-grade precision; storing the side rather than a signed amount
        /// avoids sign ambiguity across the five account types.</summary>
        public decimal OpeningBalance { get; set; }
        public bool OpeningBalanceIsDebit { get; set; }

        /// <summary>Prefilled narration when this account is chosen on a
        /// document line.</summary>
        public string? DefaultLineDescription { get; set; }

        /// <summary>Default FBR rate id for this account (e.g. Output/Input Tax
        /// at 18%), so picking the account prefills the tax code.</summary>
        public int? DefaultTaxRateId { get; set; }

        public bool IsControlAccount { get; set; }
        public ControlType ControlType { get; set; }

        public bool IsActive { get; set; } = true;

        /// <summary>Manual drag-order within the group.</summary>
        public int Position { get; set; }

        /// <summary>Stable source key ("seed:*" for the preset, a legacy account
        /// code for an import) so re-running a seed or an import upserts instead
        /// of duplicating. Null for hand-created accounts.</summary>
        public string? ExternalRef { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Navigation
        public Company Company { get; set; } = null!;
        public AccountGroup AccountGroup { get; set; } = null!;
    }
}
