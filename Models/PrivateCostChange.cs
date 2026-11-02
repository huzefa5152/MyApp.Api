namespace MyApp.Api.Models;

public class PrivateCostChange
{
    public int Id { get; set; }
    public int CompanyId { get; set; }
    public int ActorId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string Target { get; set; } = "";
    public int TargetId { get; set; }
    public string BeforeJson { get; set; } = "";
    public string AfterJson { get; set; } = "";
}
