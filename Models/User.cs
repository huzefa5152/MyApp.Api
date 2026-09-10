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

        // Account lockout (5 consecutive failures → 2h lock). State lives
        // ONLY in these columns — never cached — so an admin can unlock
        // directly via SQL: UPDATE Users SET FailedLoginAttempts = 0,
        // LockoutUntil = NULL WHERE Id = @UserId.
        public int FailedLoginAttempts { get; set; }
        public DateTime? LockoutUntil { get; set; }
        public DateTime? LastFailedLogin { get; set; }

        // Management ownership (2026-09-11). The user who created this
        // account. Drives the hierarchical admin scope: an Administrator
        // manages exactly the users beneath it in this chain, the single
        // seed admin manages everyone. NULL = root-level (the seed admin
        // itself, or a legacy account created before this column existed)
        // — root-level accounts are visible to the seed admin only. See
        // IManagementScopeService.
        public int? CreatedByUserId { get; set; }
    }
}
