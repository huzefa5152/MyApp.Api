namespace MyApp.Api.DTOs
{
    // Chart of Accounts wire shapes (design §4/§7). Enums travel as strings to
    // match the codebase's string-status convention. The tree is split by
    // statement (Balance Sheet | P&L) the way the reference product shows it.

    public class AccountDto
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public string Name { get; set; } = "";
        public string? Code { get; set; }
        public int AccountGroupId { get; set; }
        /// <summary>The group's display name ("Expenses", "Fixed assets", or a
        /// group the operator created). Shown beside the account in every account
        /// picker so two similarly-named accounts can be told apart without
        /// opening the Chart of Accounts.</summary>
        public string? AccountGroupName { get; set; }
        public string AccountType { get; set; } = "Asset";
        public string Statement { get; set; } = "BalanceSheet";  // from the group
        public string? CashFlowClass { get; set; }
        public int? DivisionId { get; set; }
        public decimal OpeningBalance { get; set; }
        public bool OpeningBalanceIsDebit { get; set; }
        public string? DefaultLineDescription { get; set; }
        public int? DefaultTaxRateId { get; set; }
        public bool IsControlAccount { get; set; }
        public string ControlType { get; set; } = "None";
        public bool IsActive { get; set; } = true;
        public int Position { get; set; }
        public string? ExternalRef { get; set; }
        /// <summary>Live balance (signed, debit-positive): opening balance +
        /// Σ(journal debits − credits). Equals the signed opening balance until
        /// GL posting is enabled for the company.</summary>
        public decimal Balance { get; set; }
        /// <summary>True when the account is referenced by any ledger/payment/
        /// transfer row — i.e. it can't be hard-deleted (deactivate instead).
        /// Populated only on the management (bank & cash) list; null elsewhere.</summary>
        public bool? HasActivity { get; set; }
    }

    /// <summary>Correct a bank/cash account's opening balance (the setup "starting
    /// balance" seed). The equal-and-opposite delta is posted to the company's
    /// Retained-earnings opening so the balance sheet stays balanced — the same
    /// discipline the reference product applies to starting balances.</summary>
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
    /// sub-groups (recursive). Used to render the two-column statement view.</summary>
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
        /// <summary>Σ of account opening balances under this node (debit-positive),
        /// for a quick subtotal in the tree.</summary>
        public decimal OpeningBalanceTotal { get; set; }
        /// <summary>Σ of LIVE account balances under this node (debit-positive) —
        /// opening + ledger movement. The figure the tree displays.</summary>
        public decimal BalanceTotal { get; set; }
    }

    /// <summary>The whole CoA for a company, split by statement (the two columns).</summary>
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
        public int? DivisionId { get; set; }
        public decimal OpeningBalance { get; set; }
        public bool OpeningBalanceIsDebit { get; set; }
        public string? DefaultLineDescription { get; set; }
        public int? DefaultTaxRateId { get; set; }
        public bool IsControlAccount { get; set; }
        public string? ControlType { get; set; }
        public string? ExternalRef { get; set; }
    }

    public class UpdateAccountDto
    {
        public string Name { get; set; } = "";
        public string? Code { get; set; }
        public int? AccountGroupId { get; set; }
        public string? CashFlowClass { get; set; }
        public int? DivisionId { get; set; }
        public decimal? OpeningBalance { get; set; }
        public bool? OpeningBalanceIsDebit { get; set; }
        public string? DefaultLineDescription { get; set; }
        public int? DefaultTaxRateId { get; set; }
        public bool? IsActive { get; set; }
        public int? Position { get; set; }
    }
}
