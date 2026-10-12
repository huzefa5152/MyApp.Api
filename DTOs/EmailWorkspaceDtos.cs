using System.ComponentModel.DataAnnotations;
namespace MyApp.Api.DTOs;
public record GmailStartDto(int CompanyId);
public record GmailCompleteDto([Required, MaxLength(2048)] string Code, [Required, MaxLength(200)] string State);
public record GmailLinkDto(int ConnectionId);
public class EmailSenderRule
{
    [Required, MaxLength(320)] public string Sender { get; set; } = "";
    [MaxLength(200)] public string? SubjectContains { get; set; }
    public int? ClientId { get; set; }
}
public class EmailLinkSettingsDto
{
    public bool ShareMatchingEmails { get; set; }
    public bool AllowCompanyReplies { get; set; }
    [Required, MaxLength(100)] public List<EmailSenderRule> Rules { get; set; } = new();
}
public record EmailDecisionDto([Required] string Decision, Guid? Revision);
public class EmailDraftDto
{
    public int? ClientId { get; set; }
    public DateTime Date { get; set; } = DateTime.UtcNow.Date;
    public DateTime? ValidUntil { get; set; }
    [MaxLength(200)] public string? CustomerEnquiryRef { get; set; }
    [MaxLength(200)] public string? ContactPerson { get; set; }
    [MaxLength(4000)] public string? Notes { get; set; }
    [Range(0, 100)] public decimal GSTRate { get; set; } = 18;
    public bool Reviewed { get; set; }
    public bool SpecificationsConfirmed { get; set; }
    public Guid? Revision { get; set; }
    [Required, MaxLength(200)] public List<EmailDraftItem> Items { get; set; } = new();
    public List<string> Warnings { get; set; } = new();
    public bool RequiresBrand { get; set; }
    public bool RequiresSpecifications { get; set; }
}
public class EmailDraftItem
{
    [MaxLength(2000)] public string? SourceDescription { get; set; }
    [MaxLength(2000)] public string Description { get; set; } = "";
    public decimal Quantity { get; set; }
    [MaxLength(100)] public string Unit { get; set; } = "";
    public decimal? UnitPrice { get; set; }
    [MaxLength(200)] public string? Brand { get; set; }
}
public class EmailAttachmentRequest
{
    [Required, MaxLength(500)] public string AttachmentId { get; set; } = "";
    public Guid? Revision { get; set; }
    public List<List<OcrWordDto>>? Pages { get; set; }
    [MaxLength(10)] public string? Mode { get; set; }
}
public class EmailAssistanceRequest
{
    public int? ClientId { get; set; }
    public Guid? Revision { get; set; }
    [Required, MaxLength(200)] public List<EmailDraftItem> Items { get; set; } = [];
}
public record EmailAttachmentPreview(string FileName, string Text, List<EmailDraftItem> Items,
    List<string> Warnings, bool RequiresOcr, bool RequiresBrand, bool RequiresSpecifications);
public record EmailPriceEvidence(decimal UnitPrice, DateTime Date, int DocumentNumber);
public record EmailItemCandidate(string Description, string Unit, int Score, string Reason,
    EmailPriceEvidence? LastQuote, EmailPriceEvidence? LastPurchase);
public record EmailItemAssistance(int Index, List<EmailItemCandidate> Candidates);
public record EmailAttachmentInfo(string Id, string FileName, string MimeType, int Size);
public record EmailContent(string Text, string Html, List<EmailAttachmentInfo> Attachments);
public record GmailIdentity(string Subject, string Email, string RefreshToken, string GrantedScopes = "https://www.googleapis.com/auth/gmail.readonly");
public record GmailBatch(List<string> MessageIds, string? NextPageToken, string? HistoryId);
public record GmailFetchedMessage(string Id, string ThreadId, string Sender, string Subject, DateTime ReceivedAt, EmailContent Content,
    bool SenderUnverified = false, bool? IsUnread = null, GmailReplyHeaders? ReplyHeaders = null);

public record GmailReplyHeaders(string MessageId, string References, string ReplyTo, List<string> To, List<string> Cc, bool InvalidRecipients = false);
public record GmailSentMessage(string Id, string ThreadId);
public record EmailReadStatusDto(bool IsUnread);
public class EmailReplyDraftDto
{
    public bool ReplyAll { get; set; }
    [MaxLength(128)] public string? TargetProviderMessageId { get; set; }
    [MaxLength(4000)] public string Introduction { get; set; } = "Please find our quotation below.";
    [MaxLength(4000)] public string Notes { get; set; } = "";
    public bool IncludeCurrentMessage { get; set; } = true;
    [Required, MaxLength(200)] public List<EmailDraftItem> Items { get; set; } = [];
}
public record EmailReplyPreview(Guid Id, string Subject, List<string> To, List<string> Cc,
    string Text, string Html, string ThreadId, string InReplyTo, string References);
