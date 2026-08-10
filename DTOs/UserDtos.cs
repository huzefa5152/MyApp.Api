using System.ComponentModel.DataAnnotations;

namespace MyApp.Api.DTOs
{
    public class CreateUserDto
    {
        [Required]
        public string Username { get; set; } = string.Empty;

        [Required]
        [MinLength(6)]
        public string Password { get; set; } = string.Empty;

        [Required]
        public string FullName { get; set; } = string.Empty;

        public string Role { get; set; } = "Admin";

        // ── One-step provisioning (all optional; each gated by its own perm) ──
        // Supplying any of these lets an admin create a user AND wire up access
        // in a single call, so the user works on first login instead of the old
        // three-screen scavenger hunt (Roles → Tenant Access → Division Access).
        // Omitting them all preserves the legacy "create a permission-blind,
        // tenant-blind user" behaviour exactly.
        //
        // RoleIds        → requires rbac.userroles.assign
        // CompanyIds     → requires tenantaccess.manage.assign
        // Divisions      → requires divisionaccess.manage.assign (+ the actor's
        //                  own access to each referenced company)
        public List<int>? RoleIds { get; set; }
        public List<int>? CompanyIds { get; set; }
        public List<CreateUserDivisionGrantDto>? Divisions { get; set; }
    }

    /// <summary>Optional per-company division restriction applied at user creation.</summary>
    public class CreateUserDivisionGrantDto
    {
        public int CompanyId { get; set; }
        // When false the user has full (all-division) access to the company and
        // DivisionIds is ignored. When true the user is limited to DivisionIds.
        public bool RestrictToDivisions { get; set; }
        public List<int>? DivisionIds { get; set; }
    }

    public class UpdateUserDto
    {
        public string? Username { get; set; }
        public string? FullName { get; set; }
        public string? Role { get; set; }

        [MinLength(6)]
        public string? Password { get; set; }
    }
}
