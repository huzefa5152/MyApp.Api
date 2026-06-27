namespace MyApp.Api.Models.Accounting
{
    /// <summary>
    /// A "New Account" in the Chart of Accounts — the dimension postings land on
    /// (design §4). A regular account is posted to directly; a control account
    /// (<see cref="IsControlAccount"/> + <see cref="ControlType"/>) is fed by a
    /// subledger (Client = AR, Supplier = AP, ItemType/stock = Inventory, bank
    /// records = Bank&amp;Cash) and must NOT be posted to or deleted directly.
    ///
    /// Names legitimately repeat (no unique-name index); an optional
    /// <see cref="Code"/> is unique per company when present. Belongs to one
    /// <see cref="AccountGroup"/>, which carries the statement.
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

        /// <summary>Cash-flow class (Balance Sheet accounts only; deferred in v1).</summary>
        public CashFlowClass? CashFlowClass { get; set; }

        /// <summary>Optional reporting dimension — reuses the existing Divisions.</summary>
        public int? DivisionId { get; set; }

        /// <summary>Opening balance and its side. decimal(19,4) to carry GL-grade
        /// precision; the side avoids signed-amount ambiguity across types.</summary>
        public decimal OpeningBalance { get; set; }
        public bool OpeningBalanceIsDebit { get; set; }

        /// <summary>"Autofill — Line description": prefilled narration when this
        /// account is chosen on a document line.</summary>
        public string? DefaultLineDescription { get; set; }

        /// <summary>"Autofill — Tax Code": default FBR rate id for this account
        /// (e.g. Output/Input Tax → 18%). Wired to the existing FBR rates.</summary>
        public int? DefaultTaxRateId { get; set; }

        public bool IsControlAccount { get; set; }
        public ControlType ControlType { get; set; }

        public bool IsActive { get; set; } = true;

        /// <summary>Manual drag-order within the group.</summary>
        public int Position { get; set; }

        /// <summary>Source-system key for imports (legacy AccountCode) — idempotent,
        /// traceable ETL. Null for hand-created accounts.</summary>
        public string? ExternalRef { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Navigation
        public Company Company { get; set; } = null!;
        public AccountGroup AccountGroup { get; set; } = null!;
    }
}
