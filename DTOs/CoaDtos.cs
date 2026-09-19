namespace MyApp.Api.DTOs
{
    // Chart of Accounts wire shapes. Enums travel as strings to match the
    // codebase's string-status convention. The tree is split by statement
    // (Balance Sheet | P&L) because that is how the two columns render.

    public class AccountDto
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public string Name { get; set; } = "";
        public string? Code { get; set; }
        public int AccountGroupId { get; set; }

        /// <summary>The group's display name ("Expenses", "Fixed assets", or a
        /// group the operator created). Shown beside the account in every picker
        /// so two similarly-named accounts can be told apart without opening the
        /// Chart of Accounts.</summary>
        public string? AccountGroupName { get; set; }

        public string AccountType { get; set; } = "Asset";
        public string Statement { get; set; } = "BalanceSheet";  // derived from the type
        public string? CashFlowClass { get; set; }
        public decimal OpeningBalance { get; set; }
        public bool OpeningBalanceIsDebit { get; set; }
        public string? DefaultLineDescription { get; set; }
        public int? DefaultTaxRateId { get; set; }
        public bool IsControlAccount { get; set; }
        public string ControlType { get; set; } = "None";
        public bool IsActive { get; set; } = true;
        public int Position { get; set; }
        public string? ExternalRef { get; set; }

        /// <summary>Live balance, signed debit-positive. Today that is the signed
        /// opening balance; once the general ledger posts it becomes opening +
        /// SUM(journal debits - credits), and every caller reading this field
        /// picks the change up without a shape change.</summary>
        public decimal Balance { get; set; }

        /// <summary>True when the account is referenced by anything — i.e. it
        /// can't be hard-deleted and the operator should deactivate instead.
        /// Populated only on the management (bank &amp; cash) list; null elsewhere,
        /// so the picker path doesn't pay for the extra query.</summary>
        public bool? HasActivity { get; set; }
    }

    /// <summary>Correct a bank/cash account's opening balance (the setup
    /// "starting balance" seed). The equal-and-opposite delta lands on the
    /// company's Retained-earnings opening so the opening balance sheet still
    /// balances afterwards.</summary>
    public class AdjustOpeningBalanceDto
    {
        public decimal OpeningBalance { get; set; }
        public bool OpeningBalanceIsDebit { get; set; }
    }

    public class AccountGroupDto
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public string Name { get; set; } = "";
        public string Statement { get; set; } = "BalanceSheet";
        public int? ParentGroupId { get; set; }
        public int Position { get; set; }
        public bool IsSystem { get; set; }
        public string? ExternalRef { get; set; }
    }

    /// <summary>One node in the CoA tree: a group with its direct accounts and
    /// sub-groups (recursive).</summary>
    public class CoaGroupNode
    {
        public int Id { get; set; }
        public string Name { get; set; } = "";
        public string Statement { get; set; } = "BalanceSheet";
        public int? ParentGroupId { get; set; }
        public int Position { get; set; }
        public bool IsSystem { get; set; }
        public string? ExternalRef { get; set; }
        public List<AccountDto> Accounts { get; set; } = new();
        public List<CoaGroupNode> Children { get; set; } = new();

        /// <summary>SUM of account opening balances under this node
        /// (debit-positive), for a quick subtotal in the tree.</summary>
        public decimal OpeningBalanceTotal { get; set; }

        /// <summary>SUM of LIVE account balances under this node (debit-positive).
        /// The figure the tree displays.</summary>
        public decimal BalanceTotal { get; set; }
    }

    /// <summary>The whole chart for a company, split by statement.</summary>
    public class CoaTreeDto
    {
        public List<CoaGroupNode> BalanceSheet { get; set; } = new();
        public List<CoaGroupNode> ProfitAndLoss { get; set; } = new();
    }

    public class CreateAccountGroupDto
    {
        public string Name { get; set; } = "";
        public string Statement { get; set; } = "BalanceSheet";
        public int? ParentGroupId { get; set; }
        public string? ExternalRef { get; set; }
    }

    public class UpdateAccountGroupDto
    {
        public string Name { get; set; } = "";
        public int? ParentGroupId { get; set; }
        public int? Position { get; set; }
    }

    public class CreateAccountDto
    {
        public string Name { get; set; } = "";
        public string? Code { get; set; }
        public int AccountGroupId { get; set; }
        public string? AccountType { get; set; }          // inferred from the group's statement when null
        public string? CashFlowClass { get; set; }
        public decimal OpeningBalance { get; set; }
        public bool OpeningBalanceIsDebit { get; set; }
        public string? DefaultLineDescription { get; set; }
        public int? DefaultTaxRateId { get; set; }
        public string? ControlType { get; set; }
        public string? ExternalRef { get; set; }
    }

    public class UpdateAccountDto
    {
        public string Name { get; set; } = "";
        public string? Code { get; set; }
        public int? AccountGroupId { get; set; }
        public string? CashFlowClass { get; set; }
        public decimal? OpeningBalance { get; set; }
        public bool? OpeningBalanceIsDebit { get; set; }
        public string? DefaultLineDescription { get; set; }
        public int? DefaultTaxRateId { get; set; }
        public bool? IsActive { get; set; }
        public int? Position { get; set; }
    }
}
