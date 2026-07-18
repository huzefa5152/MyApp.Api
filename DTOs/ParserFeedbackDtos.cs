namespace MyApp.Api.DTOs
{
    /// <summary>Wire shape for one parser-feedback record. The on-disk PDF
    /// location is intentionally NOT exposed — download it via the endpoint.</summary>
    public class ParserFeedbackDto
    {
        public int Id { get; set; }
        public int? PurchaseOrderId { get; set; }
        public int? CompanyId { get; set; }
        public string? OriginalFileName { get; set; }
        public long FileSizeBytes { get; set; }
        public string? ParserVersion { get; set; }
        public string FeedbackStatus { get; set; } = "";   // enum name: Correct / Incorrect
        public bool HasPdf { get; set; }
        public string? CreatedBy { get; set; }
        public DateTime CreatedDate { get; set; }
    }

    /// <summary>Paged, filtered list result for the incorrect-imports view.</summary>
    public class ParserFeedbackPageDto
    {
        public int Total { get; set; }
        public int Page { get; set; }
        public int PageSize { get; set; }
        public List<ParserFeedbackDto> Rows { get; set; } = new();
    }

    /// <summary>Aggregate accuracy figures, overall and per parser version.</summary>
    public class ParserFeedbackStatisticsDto
    {
        public int TotalImports { get; set; }
        public int SuccessfulImports { get; set; }
        public int FailedImports { get; set; }
        public double SuccessRate { get; set; }   // 0..1
        public List<ParserVersionStatDto> ByParserVersion { get; set; } = new();
    }

    public class ParserVersionStatDto
    {
        public string ParserVersion { get; set; } = "";
        public int Total { get; set; }
        public int Successful { get; set; }
        public int Failed { get; set; }
        public double SuccessRate { get; set; }   // 0..1
    }

    /// <summary>Body for the bulk-download (ZIP) endpoint.</summary>
    public class ParserFeedbackBulkDownloadDto
    {
        public List<int> Ids { get; set; } = new();
    }
}
