namespace MyApp.Api.DTOs
{
    public class AuditLogDto
    {
        public int Id { get; set; }
        /// <summary>The company the row was written for; null for installation events.</summary>
        public int? CompanyId { get; set; }
        public DateTime Timestamp { get; set; }
        public string Level { get; set; } = "";
        public string? UserName { get; set; }
        public string HttpMethod { get; set; } = "";
        public string RequestPath { get; set; } = "";
        public int StatusCode { get; set; }
        public string ExceptionType { get; set; } = "";
        public string Message { get; set; } = "";
        public string? StackTrace { get; set; }
        public string? RequestBody { get; set; }
        public string? QueryString { get; set; }
    }
}
