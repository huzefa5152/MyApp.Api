namespace MyApp.Api.DTOs
{
    public class AuditLogDto
    {
        public int Id { get; set; }
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
        /// <summary>
        /// Which company the event belongs to, or null for a platform event
        /// (login failure, startup, anything raised outside a company context).
        /// Exposed since the log became company-scoped on 2026-09-21: an
        /// administrator reading several companies needs to see which one a row
        /// is about, and a null here is a row only the seed admin is served.
        /// </summary>
        public int? CompanyId { get; set; }
    }
}
