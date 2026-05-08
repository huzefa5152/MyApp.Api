namespace MyApp.Api.DTOs
{
    public class FbrCommunicationLogDto
    {
        public long Id { get; set; }
        public DateTime Timestamp { get; set; }
        public int CompanyId { get; set; }
        public int? InvoiceId { get; set; }
        public string? CorrelationId { get; set; }
        public string Action { get; set; } = "";
        public string Endpoint { get; set; } = "";
        public string HttpMethod { get; set; } = "";
        public int? HttpStatusCode { get; set; }
        public string Status { get; set; } = "";
        public string? FbrErrorCode { get; set; }
        public string? FbrErrorMessage { get; set; }
        public int RequestDurationMs { get; set; }
        public int RetryAttempt { get; set; }
        public string? RequestBodyMasked { get; set; }
        public string? ResponseBodyMasked { get; set; }
        public string? UserName { get; set; }
    }

    /// <summary>Aggregate counts displayed on the FBR monitor page header.</summary>
    public class FbrCommunicationSummaryDto
    {
        public DateTime Since { get; set; }
        public int TotalCalls { get; set; }
        public int Submitted { get; set; }
        public int Acknowledged { get; set; }
        public int Rejected { get; set; }
        public int Failed { get; set; }
        public int Uncertain { get; set; }
        public double AvgDurationMs { get; set; }
        // Top FBR error codes — keyed by code, value is occurrence count.
        // Lets the UI show "0024 occurred 18× today" without a second query.
        public Dictionary<string, int> TopErrorCodes { get; set; } = new();
    }
}
