namespace MyApp.Api.Models;

/// <summary>
/// A write an agent has PREPARED but not yet committed. Nothing in the ERP exists until
/// commit_action runs: the plan is validated and priced up front, shown to the human, and
/// executed exactly once — within ten minutes, by the same token, with every permission and
/// company check made again at that moment. An idempotency key (an email id, say) makes a
/// repeated prepare return the original plan or result instead of a duplicate.
/// </summary>
public class McpPendingAction
{
    public const int LifetimeMinutes = 10;

    public int Id { get; set; }
    /// <summary>Random identifier the agent holds; useless to any other token.</summary>
    public string PlanId { get; set; } = "";
    public int AgentTokenId { get; set; }
    public int UserId { get; set; }
    public int CompanyId { get; set; }
    /// <summary>"client.create", "client.update", "quote.create", ...</summary>
    public string Kind { get; set; } = "";
    /// <summary>The exact DTO that commit will hand to the service, as JSON.</summary>
    public string Payload { get; set; } = "";
    /// <summary>One-line, human-readable description of what commit will do.</summary>
    public string Summary { get; set; } = "";
    public string? IdempotencyKey { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime ExpiresAt { get; set; }
    public DateTime? CommittedAt { get; set; }
    /// <summary>The document a commit produced, e.g. "SalesQuote:42"; "FAILED" if it could not be created.</summary>
    public string? ResultRef { get; set; }
    public string? ResultSummary { get; set; }
}
