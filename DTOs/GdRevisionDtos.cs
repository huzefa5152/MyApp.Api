namespace MyApp.Api.DTOs
{
    /// <summary>What a revised sheet does to one line of a recorded GD.</summary>
    public static class GdRevisionActions
    {
        public const string Unchanged = "unchanged";
        public const string Changed = "changed";
        public const string New = "new";
        public const string Removed = "removed";
    }

    public class GdRevisionRowDto
    {
        public string Action { get; set; } = GdRevisionActions.Unchanged;

        /// <summary>The recorded line, when there is one.</summary>
        public int? LineId { get; set; }

        /// <summary>The row of the revised sheet, when there is one.</summary>
        public int? SheetRow { get; set; }

        public string? HsCode { get; set; }
        public string? Description { get; set; }
        public string? ItemTypeName { get; set; }
        public string? Unit { get; set; }
        public decimal? OldQuantity { get; set; }
        public decimal? NewQuantity { get; set; }
        public decimal? OldCost { get; set; }
        public decimal? NewCost { get; set; }
        public decimal? OldSellingValue { get; set; }
        public decimal? NewSellingValue { get; set; }

        /// <summary>Why this row stops the revision; empty when it does not.</summary>
        public List<string> Problems { get; set; } = new();
    }

    public class GdRevisionPreviewDto
    {
        public int ConsignmentId { get; set; }
        public string GdNumber { get; set; } = "";
        public List<GdRevisionRowDto> Rows { get; set; } = new();
        public int Unchanged { get; set; }
        public int Changed { get; set; }
        public int Added { get; set; }
        public int Removed { get; set; }
        public decimal OldTotalCost { get; set; }
        public decimal NewTotalCost { get; set; }
        public decimal OldTotalSellingValue { get; set; }
        public decimal NewTotalSellingValue { get; set; }
        public List<string> BlockingErrors { get; set; } = new();
        public List<string> Warnings { get; set; } = new();

        /// <summary>The sheet as read. Its lines go back, unchanged, to apply the revision.</summary>
        public GdCostingPreviewDto Sheet { get; set; } = new();
    }

    public class GdRevisionCommitDto
    {
        /// <summary>The preview's <c>Sheet.Lines</c>, unchanged.</summary>
        public List<GdCostingLineDto> Lines { get; set; } = new();
        public string? FileSha256 { get; set; }
        public string? FileName { get; set; }
        public long FileSizeBytes { get; set; }
        public int? ImportProfileId { get; set; }
        public int? ProfileVersion { get; set; }

        /// <summary>Kept in the cost history and the audit log.</summary>
        public string? Reason { get; set; }
    }

    public class GdRevisionResultDto
    {
        public int ConsignmentId { get; set; }
        public string GdNumber { get; set; } = "";
        public int LinesChanged { get; set; }
        public int LinesAdded { get; set; }
        public int LinesRemoved { get; set; }
        public decimal OldTotalCost { get; set; }
        public decimal NewTotalCost { get; set; }
        public decimal ImportClearingCredited { get; set; }
        public List<string> Messages { get; set; } = new();
    }
}
