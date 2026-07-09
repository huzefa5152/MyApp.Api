namespace MyApp.Api.DTOs
{
    /// <summary>Read shape for an inter-account transfer — money moved between
    /// two of the company's own bank/cash accounts. Account/Division names are
    /// resolved server-side so list views render without extra lookups.</summary>
    public class AccountTransferDto
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public int Number { get; set; }
        /// <summary>Display reference: "TRF-####".</summary>
        public string Reference { get; set; } = "";
        public DateTime Date { get; set; }

        /// <summary>Paying account (credited).</summary>
        public int FromAccountId { get; set; }
        public string FromAccountName { get; set; } = "";

        /// <summary>Receiving account (debited).</summary>
        public int ToAccountId { get; set; }
        public string ToAccountName { get; set; } = "";

        public decimal Amount { get; set; }
        public string? Description { get; set; }

        /// <summary>Optional Division tag and its resolved name.</summary>
        public int? DivisionId { get; set; }
        public string? DivisionName { get; set; }

        public DateTime CreatedAt { get; set; }
    }

    /// <summary>Create/update shape. Number is allocated server-side (max+1 per
    /// company under NumberAllocationRetry); both accounts are validated to be
    /// this company's bank/cash accounts — never trusted from the body.</summary>
    public class CreateAccountTransferDto
    {
        public DateTime Date { get; set; }
        public int FromAccountId { get; set; }
        public int ToAccountId { get; set; }
        public decimal Amount { get; set; }
        public string? Description { get; set; }

        /// <summary>Optional Division tag (validated against the company server-side).</summary>
        public int? DivisionId { get; set; }
    }
}
