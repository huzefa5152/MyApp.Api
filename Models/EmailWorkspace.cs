using System.ComponentModel.DataAnnotations;
namespace MyApp.Api.Models;

public class GmailConnection
{
    public int Id { get; set; }
    public int OwnerUserId { get; set; }
    [MaxLength(255)] public string GoogleSubject { get; set; } = "";
    [MaxLength(320)] public string EmailAddress { get; set; } = "";
    public string ProtectedRefreshToken { get; set; } = "";
    [MaxLength(24)] public string Status { get; set; } = "Connected";
    [MaxLength(200)] public string? LastError { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime BackfillSince { get; set; } = DateTime.UtcNow.AddDays(-30);
    public string? PageToken { get; set; }
    public string? HistoryId { get; set; }
    public bool BackfillComplete { get; set; }
    public DateTime? LastSyncedAt { get; set; }
    public DateTime? SyncLeaseUntil { get; set; }
    public Guid? SyncLeaseId { get; set; }
    public DateTime NextSyncAt { get; set; } = DateTime.UtcNow;
}
public class GmailCompanyLink
{
    public int Id { get; set; }
    public int ConnectionId { get; set; }
    public GmailConnection Connection { get; set; } = null!;
    public int CompanyId { get; set; }
    public bool ShareMatchingEmails { get; set; }
    public bool IsEnabled { get; set; } = true;
    public string RulesJson { get; set; } = "[]";
}
public class GmailMessage
{
    public int Id { get; set; }
    public int ConnectionId { get; set; }
    public GmailConnection Connection { get; set; } = null!;
    [MaxLength(128)] public string ProviderMessageId { get; set; } = "";
    [MaxLength(128)] public string ThreadId { get; set; } = "";
    [MaxLength(320)] public string Sender { get; set; } = "";
    [MaxLength(1000)] public string Subject { get; set; } = "";
    public DateTime ReceivedAt { get; set; }
    public string ProtectedContent { get; set; } = "";
    /// <summary>
    /// Gmail's own Authentication-Results said dmarc=fail: the From address is
    /// forged or broken. The owner still sees the message, but a sender rule never
    /// shares it with the company or picks its customer, because anyone can type
    /// a rule's address into From. False for every message synced before this.
    /// </summary>
    public bool SenderUnverified { get; set; }
}
public class EmailEnquiry
{
    public int Id { get; set; }
    public int CompanyId { get; set; }
    public int MessageId { get; set; }
    public GmailMessage Message { get; set; } = null!;
    [MaxLength(16)] public string Decision { get; set; } = "Kept";
    public string ProtectedDraft { get; set; } = "";
    public int? SalesQuoteId { get; set; }
    public int? SalesQuoteNumber { get; set; }
    public int DecidedByUserId { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public Guid Revision { get; set; } = Guid.NewGuid();
}
public class GmailOAuthRequest
{
    [MaxLength(64)] public string StateHash { get; set; } = "";
    public int UserId { get; set; }
    public int CompanyId { get; set; }
    public string ProtectedVerifier { get; set; } = "";
    public DateTime ExpiresAt { get; set; }
    public bool Used { get; set; }
}
public class EmailWorkspaceEvent
{
    public long Id { get; set; }
    public int CompanyId { get; set; }
    public int UserId { get; set; }
    public int? EnquiryId { get; set; }
    [MaxLength(40)] public string Action { get; set; } = "";
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
}
