namespace MyApp.Api.DTOs
{
    /// <summary>
    /// One parsed row of an uploaded client sheet, with the verdict the
    /// operator sees before anything is written.
    /// </summary>
    public class ClientImportRowDto
    {
        /// <summary>1-based row number in the uploaded file, header excluded —
        /// so an error message can point the operator at the right line.</summary>
        public int RowNumber { get; set; }

        public string? Name { get; set; }
        public string? Address { get; set; }
        public string? Phone { get; set; }
        public string? Email { get; set; }
        public string? NTN { get; set; }
        public string? STRN { get; set; }
        public string? CNIC { get; set; }
        public string? RegistrationType { get; set; }
        public string? Site { get; set; }
        public int? FbrProvinceCode { get; set; }

        /// <summary>"New" | "Duplicate" | "Error" — see ClientImportStatus.</summary>
        public string Status { get; set; } = ClientImportStatus.New;

        /// <summary>Why the row is a duplicate or an error. Empty for clean rows.</summary>
        public List<string> Messages { get; set; } = new();
    }

    public static class ClientImportStatus
    {
        /// <summary>Will be created.</summary>
        public const string New = "New";

        /// <summary>Matches a client this company already has — skipped, not overwritten.</summary>
        public const string Duplicate = "Duplicate";

        /// <summary>Unusable as it stands (no name, bad province code, …) — skipped.</summary>
        public const string Error = "Error";
    }

    /// <summary>What the preview step returns: every row plus the totals the dialog shows.</summary>
    public class ClientImportPreviewDto
    {
        public string FileName { get; set; } = "";
        public int TotalRows { get; set; }
        public int NewCount { get; set; }
        public int DuplicateCount { get; set; }
        public int ErrorCount { get; set; }
        public List<ClientImportRowDto> Rows { get; set; } = new();

        /// <summary>File-level problems (unreadable file, missing Name column, row cap hit).</summary>
        public List<string> FileMessages { get; set; } = new();
    }

    /// <summary>Body of the commit step — the rows the operator confirmed.</summary>
    public class ClientImportCommitDto
    {
        public int CompanyId { get; set; }
        public List<ClientImportRowDto> Rows { get; set; } = new();

        /// <summary>
        /// Create rows the preview flagged as duplicates anyway. Off by default:
        /// the point of the preview is that re-uploading the same sheet does not
        /// double the customer list.
        /// </summary>
        public bool IncludeDuplicates { get; set; }
    }

    public class ClientImportResultDto
    {
        public int Created { get; set; }
        public int SkippedDuplicates { get; set; }
        public int Failed { get; set; }

        /// <summary>Per-row failures, "Row 12: …". Capped; an import never aborts on them.</summary>
        public List<string> Errors { get; set; } = new();
    }
}
