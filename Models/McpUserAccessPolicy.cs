using System.ComponentModel.DataAnnotations;

namespace MyApp.Api.Models;

/// <summary>Administrator grants form the ceiling; the user's preferences may only narrow it.</summary>
public class McpUserAccessPolicy
{
    [Key]
    public int UserId { get; set; }
    public bool AccessGranted { get; set; }
    public bool WritesGranted { get; set; }
    public string GrantedTools { get; set; } = "[]";
    public bool AccessEnabled { get; set; } = true;
    public bool WritesEnabled { get; set; } = true;
    /// <summary>Null chooses all granted tools; otherwise a JSON array of selected tool names.</summary>
    public string? SelectedTools { get; set; }
    public Guid Revision { get; set; } = Guid.NewGuid();
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public int? UpdatedByUserId { get; set; }
    public User? User { get; set; }
}
