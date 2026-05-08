namespace MyApp.Api.DTOs
{
    /// <summary>One row in the User → Company assignment grid.</summary>
    public class UserCompanyAssignmentDto
    {
        public int UserId { get; set; }
        public string Username { get; set; } = "";
        public string FullName { get; set; } = "";
        public string? AvatarPath { get; set; }
        public List<UserCompanyMemberDto> Companies { get; set; } = new();
    }

    public class UserCompanyMemberDto
    {
        public int CompanyId { get; set; }
        public string CompanyName { get; set; } = "";
        public bool IsTenantIsolated { get; set; }
        public bool HasExplicitGrant { get; set; }
        public DateTime? AssignedAt { get; set; }
    }

    /// <summary>
    /// Replaces the full set of companies a user has explicit access to.
    /// Idempotent. Inserts missing rows, deletes obsolete ones, and leaves
    /// matching rows untouched (preserves AssignedAt and AssignedByUserId
    /// for audit). Use this rather than per-row POST/DELETE so a checkbox
    /// grid maps cleanly to one HTTP call.
    /// </summary>
    public class SetUserCompaniesDto
    {
        public List<int> CompanyIds { get; set; } = new();
    }

    public class SetUserCompaniesResultDto
    {
        public int UserId { get; set; }
        public int Added { get; set; }
        public int Removed { get; set; }
        public int Total { get; set; }
    }
}
