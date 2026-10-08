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
    [MaxLength(2000)] public string Description { get; set; } = "";
    public decimal Quantity { get; set; }
    [MaxLength(100)] public string Unit { get; set; } = "";
    public decimal? UnitPrice { get; set; }
    [MaxLength(200)] public string? Brand { get; set; }
}
public record EmailAttachmentInfo(string Id, string FileName, string MimeType, int Size);
public record EmailContent(string Text, string Html, List<EmailAttachmentInfo> Attachments);
public record GmailIdentity(string Subject, string Email, string RefreshToken);
public record GmailBatch(List<string> MessageIds, string? NextPageToken, string? HistoryId);
public record GmailFetchedMessage(string Id, string ThreadId, string Sender, string Subject, DateTime ReceivedAt, EmailContent Content);
