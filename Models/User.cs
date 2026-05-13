namespace MyApp.Api.Models
{
    public class User
    {
        public int Id { get; set; }
        public string Username { get; set; } = string.Empty;
        public string PasswordHash { get; set; } = string.Empty;
        public string FullName { get; set; } = string.Empty;
        public string Role { get; set; } = "User";
        public string? AvatarPath { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Token-revocation marker. Audit C-6 (2026-05-13): bumping this
        // value invalidates every JWT previously issued for this user on
        // the next request. The token validator compares the embedded
        // "stamp" claim to this column; mismatch → 401. Bump on logout,
        // password change, and role change.
        public string SecurityStamp { get; set; } = Guid.NewGuid().ToString("N");
    }
}
