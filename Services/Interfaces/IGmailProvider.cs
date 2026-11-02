using MyApp.Api.DTOs;
namespace MyApp.Api.Services.Interfaces;
public interface IGmailProvider
{
    bool IsConfigured { get; }
    string RedirectUri { get; }
    string AuthorizationUrl(string state, string challenge);
    string UpgradeAuthorizationUrl(string state, string challenge) => throw new NotSupportedException();
    Task<List<GmailFetchedMessage>> ThreadAsync(string token, string threadId, CancellationToken ct) => throw new NotSupportedException();
    Task SetUnreadAsync(string token, string id, bool unread, CancellationToken ct) => throw new NotSupportedException();
    Task<GmailSentMessage> SendReplyAsync(string token, EmailReplyPreview preview, string from, CancellationToken ct) => throw new NotSupportedException();
    Task<string?> FindSentReplyAsync(string token, Guid attemptId, CancellationToken ct) => throw new NotSupportedException();
    Task<GmailIdentity> ExchangeAsync(string code, string verifier, CancellationToken ct);
    Task<string> RefreshAsync(string refreshToken, CancellationToken ct);
    Task<string> GetHistoryIdAsync(string accessToken, CancellationToken ct);
    Task<GmailBatch> ListAsync(string accessToken, DateTime since, string? pageToken, CancellationToken ct);
    Task<GmailBatch> HistoryAsync(string accessToken, string historyId, string? pageToken, CancellationToken ct);
    Task<GmailFetchedMessage?> ReadAsync(string accessToken, string id, CancellationToken ct);
    Task<byte[]> AttachmentAsync(string accessToken, string messageId, string attachmentId, CancellationToken ct);
    /// <summary>Tell Google to invalidate a refresh token we are discarding. Best effort.</summary>
    Task RevokeAsync(string refreshToken, CancellationToken ct) => Task.CompletedTask;
}
