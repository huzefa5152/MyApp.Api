namespace MyApp.Api.Models;

public class UserSession
{
    public string Id { get; set; } = "";
    public string SecurityStamp { get; set; } = "";
    public int UserId { get; set; }
    public DateTime TokenExpiresAt { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime LastSeenAt { get; set; }
    public DateTime? RevokedAt { get; set; }
    public string UserAgent { get; set; } = "";
    public string IpAddress { get; set; } = "";
    public bool IsRevoked { get; set; }
}
