namespace MyApp.Api.DTOs
{
    public class AuditSummaryDto
    {
        public int ErrorsLast24h { get; set; }
        public int WarningsLast24h { get; set; }
    }
}
