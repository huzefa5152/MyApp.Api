namespace MyApp.Api.DTOs
{
    /// <summary>One row in the User → Division assignment grid (one company).</summary>
    public class UserDivisionAssignmentDto
    {
        public int UserId { get; set; }
        public string Username { get; set; } = "";
        public string FullName { get; set; } = "";
        public string? AvatarPath { get; set; }
        /// <summary>False = unrestricted: the user sees every division of the
        /// company and the Divisions list below is informational only.</summary>
        public bool RestrictToDivisions { get; set; }
        public List<UserDivisionMemberDto> Divisions { get; set; } = new();
    }

    public class UserDivisionMemberDto
    {
        public int DivisionId { get; set; }
        public string DivisionName { get; set; } = "";
        public bool HasExplicitGrant { get; set; }
        public DateTime? AssignedAt { get; set; }
    }

    /// <summary>
    /// Replaces the full set of divisions a user may access within ONE
    /// company, plus the restriction flag itself. Idempotent — mirrors
    /// SetUserCompaniesDto: inserts missing rows, deletes obsolete ones,
    /// preserves AssignedAt/AssignedByUserId on unchanged rows.
    /// </summary>
    public class SetUserDivisionsDto
    {
        public bool RestrictToDivisions { get; set; }
        public List<int> DivisionIds { get; set; } = new();
    }

    public class SetUserDivisionsResultDto
    {
        public int UserId { get; set; }
        public int CompanyId { get; set; }
        public bool RestrictToDivisions { get; set; }
        public int Added { get; set; }
        public int Removed { get; set; }
        public int Total { get; set; }
    }
}
