namespace MyApp.Api.Models
{
    public class Permission
    {
        public int Id { get; set; }

        // "module.page.action", e.g. "users.manage.create". Unique.
        public string Key { get; set; } = string.Empty;

        public string Module { get; set; } = string.Empty;
        public string Page { get; set; } = string.Empty;
        public string Action { get; set; } = string.Empty;

        public string? Description { get; set; }

        public ICollection<RolePermission> RolePermissions { get; set; } = new List<RolePermission>();
    }
}
