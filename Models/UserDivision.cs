namespace MyApp.Api.Models
{
    /// <summary>
    /// Explicit grant: this user may access this division's data. Only
    /// consulted when the user's <see cref="UserCompany.RestrictToDivisions"/>
    /// flag is set for the division's company — unrestricted users (the
    /// default) see every division without rows here. Mirrors
    /// <see cref="UserCompany"/>; enforced by <c>IDivisionAccessGuard</c>.
    /// </summary>
    public class UserDivision
    {
        public int UserId { get; set; }
        public User? User { get; set; }

        public int DivisionId { get; set; }
        public Division? Division { get; set; }

        public DateTime AssignedAt { get; set; } = DateTime.UtcNow;
        public int? AssignedByUserId { get; set; }
    }
}
