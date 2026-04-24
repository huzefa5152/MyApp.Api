namespace MyApp.Api.DTOs
{
    // ── Permissions ─────────────────────────────────────────────────────────

    public class PermissionDto
    {
        public int Id { get; set; }
        public string Key { get; set; } = string.Empty;
        public string Module { get; set; } = string.Empty;
        public string Page { get; set; } = string.Empty;
        public string Action { get; set; } = string.Empty;
        public string? Description { get; set; }
    }

    /// <summary>Catalog shape consumed by the role-editor tree UI.</summary>
    public class PermissionTreeDto
    {
        public string Module { get; set; } = string.Empty;
        public List<PermissionTreePageDto> Pages { get; set; } = new();
    }

    public class PermissionTreePageDto
    {
        public string Page { get; set; } = string.Empty;
        public List<PermissionDto> Permissions { get; set; } = new();
    }

    // ── Roles ───────────────────────────────────────────────────────────────

    public class RoleDto
    {
        public int Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public string? Description { get; set; }
        public bool IsSystemRole { get; set; }
        public DateTime CreatedAt { get; set; }
        public int UserCount { get; set; }
        public List<string> PermissionKeys { get; set; } = new();
    }

    public class CreateRoleDto
    {
        public string Name { get; set; } = string.Empty;
        public string? Description { get; set; }
        public List<string> PermissionKeys { get; set; } = new();
    }

    public class UpdateRoleDto
    {
        public string? Name { get; set; }
        public string? Description { get; set; }
        // When null, permissions are left unchanged. When provided (even empty), replaces the role's permission set.
        public List<string>? PermissionKeys { get; set; }
    }

    // ── User ↔ Role ─────────────────────────────────────────────────────────

    public class UserRolesDto
    {
        public int UserId { get; set; }
        public string Username { get; set; } = string.Empty;
        public string FullName { get; set; } = string.Empty;
        public List<RoleSummaryDto> Roles { get; set; } = new();
    }

    public class RoleSummaryDto
    {
        public int Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public bool IsSystemRole { get; set; }
    }

    public class AssignUserRolesDto
    {
        // Full replacement — the user will end up with exactly these roles.
        public List<int> RoleIds { get; set; } = new();
    }
}
