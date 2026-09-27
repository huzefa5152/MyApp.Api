namespace MyApp.Api.DTOs
{
    /// <summary>Row status on the wire: import, warning (imports), exists (skipped), error (skipped).</summary>
    public static class OnboardingRowStatus
    {
        public const string Import = "import";
        public const string Warning = "warning";
        public const string Exists = "exists";
        public const string Error = "error";

        public static bool WillImport(string status) => status == Import || status == Warning;
    }

    public class OnboardingIssueDto
    {
        public string? Column { get; set; }
        public string Message { get; set; } = "";
        public bool IsError { get; set; }
    }

    public class OnboardingRowDto
    {
        /// <summary>The spreadsheet row number, as the operator sees it in Excel.</summary>
        public int RowNumber { get; set; }
        public string Status { get; set; } = OnboardingRowStatus.Import;
        /// <summary>What the row is: the customer / supplier / item name.</summary>
        public string Label { get; set; } = "";
        public List<OnboardingIssueDto> Issues { get; set; } = new();
    }

    public class OnboardingSheetPreviewDto
    {
        public string Key { get; set; } = "";
        public string Title { get; set; } = "";
        /// <summary>False when the uploaded workbook has no sheet of this title.</summary>
        public bool Present { get; set; }
        public int ToImport { get; set; }
        public int WithWarnings { get; set; }
        public int Existing { get; set; }
        public int Errors { get; set; }
        public List<string> SheetWarnings { get; set; } = new();
        public List<OnboardingRowDto> Rows { get; set; } = new();
    }

    public class OnboardingPreviewDto
    {
        public List<OnboardingSheetPreviewDto> Sheets { get; set; } = new();
        /// <summary>Rows that will be created on Import (import + warning), all sheets.</summary>
        public int TotalToImport { get; set; }
    }

    public class OnboardingSheetResultDto
    {
        public string Key { get; set; } = "";
        public string Title { get; set; } = "";
        public int Created { get; set; }
        /// <summary>Already existed, or had an error in the preview.</summary>
        public int Skipped { get; set; }
        /// <summary>Passed the preview but the save refused it.</summary>
        public int Failed { get; set; }
        public List<OnboardingRowDto> FailedRows { get; set; } = new();
    }

    public class OnboardingCommitResultDto
    {
        public List<OnboardingSheetResultDto> Sheets { get; set; } = new();
        public int TotalCreated { get; set; }
    }
}
