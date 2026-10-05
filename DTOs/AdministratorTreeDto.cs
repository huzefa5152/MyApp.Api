namespace MyApp.Api.DTOs
{
    /// <summary>One top-level account in the seed admin's console, with its tree.</summary>
    public class AdministratorTreeDto
    {
        public int UserId { get; set; }
        public string Username { get; set; } = "";
        public string FullName { get; set; } = "";
        public string Role { get; set; } = "";
        public string? AvatarPath { get; set; }
        public DateTime CreatedAt { get; set; }
        /// <summary>True when CreatedByUserId is NULL (pre-ownership row) rather than the seed admin.</summary>
        public bool IsLegacyRoot { get; set; }
        public List<string> Roles { get; set; } = new();
        /// <summary>Companies this account itself holds a grant for.</summary>
        public List<int> CompanyIds { get; set; } = new();
        public List<AdministratorTreeUserDto> Users { get; set; } = new();
        public List<AdministratorTreeCompanyDto> Companies { get; set; } = new();
    }

    public class AdministratorTreeUserDto
    {
        public int UserId { get; set; }
        public string Username { get; set; } = "";
        public string FullName { get; set; } = "";
        public string Role { get; set; } = "";
        public string? AvatarPath { get; set; }
        public DateTime CreatedAt { get; set; }
        public int? CreatedByUserId { get; set; }
        public List<string> Roles { get; set; } = new();
        public List<int> CompanyIds { get; set; } = new();
    }

    public class AdministratorTreeCompanyDto
    {
        public int CompanyId { get; set; }
        public string Name { get; set; } = "";
        public bool IsTenantIsolated { get; set; }
        public int? CreatedByUserId { get; set; }
    }
}
