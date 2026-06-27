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
