namespace MyApp.Api.Models;

/// <summary>
/// One row per tools/call on POST /mcp — allowed, refused or failed. Append-only:
/// nothing in the application updates or deletes these rows, and no endpoint
/// offers to. It deliberately holds no foreign keys, so deleting a token or a
/// user can never remove the record of what that agent did.
/// </summary>
public class McpActivity
{
    public long Id { get; set; }
    public DateTime At { get; set; } = DateTime.UtcNow;
    /// <summary>Null when the call came in on an ordinary login token.</summary>
    public int? AgentTokenId { get; set; }
    public string AgentName { get; set; } = "";
    /// <summary>"agent" (an MCP token) or "login" (the user's own session token).</summary>
    public string AuthKind { get; set; } = "login";
    public int UserId { get; set; }
    public string Username { get; set; } = "";
    public string Tool { get; set; } = "";
    public int? CompanyId { get; set; }
    /// <summary>Tool arguments after <c>SensitiveDataRedactor</c>, truncated.</summary>
    public string Arguments { get; set; } = "";
    /// <summary>"ok", "denied" or "error".</summary>
    public string Outcome { get; set; } = "ok";
    /// <summary>Why a call was refused or failed. Never raw exception text.</summary>
    public string Detail { get; set; } = "";
    /// <summary>The document a write produced, e.g. "SalesQuote:42". Empty for reads.</summary>
    public string ResultRef { get; set; } = "";
    public int DurationMs { get; set; }
    public string IpAddress { get; set; } = "";
    public string? CorrelationId { get; set; }
}
