namespace MyApp.Api.Models
{
    /// <summary>
    /// Audit / archive row for every PO PDF the operator runs through the
    /// rule-based parser. The original PDF bytes are kept on disk under
    /// <c>Data/uploads/po_imports/{YYYY}/{MM}/{guid}.pdf</c> so failing imports
    /// can be triaged later — was it a missing format, stale rules, or a
    /// scanned image we can't OCR? — without asking the operator to re-upload.
    ///
    /// Side-effect only: nothing in the parsing flow depends on this row, and
    /// a write failure here logs a warning but never breaks the import.
    /// </summary>
    public class PoImportArchive
    {
        public int Id { get; set; }

        // Tenant + user context — both nullable because the parse endpoint
        // accepts an optional companyId (legacy callers) and we want to
        // keep capturing data even if claims look weird.
        public int? CompanyId { get; set; }
        public int? UploadedByUserId { get; set; }

        public DateTime UploadedAt { get; set; }

        // Original filename as the browser sent it. Useful for human triage
        // ("the Lotte one from yesterday") even though we store under a GUID.
        public string OriginalFileName { get; set; } = "";

        // Path relative to Data/uploads/po_imports — e.g. "2026/05/abcd.pdf".
        // The absolute path is reconstructed at read-time using the host
        // ContentRootPath so the value stays portable across deploys.
        public string StoredPath { get; set; } = "";

        public long FileSizeBytes { get; set; }

        // SHA-256 of the file bytes — handy for dedup detection and for
        // proving the file on disk hasn't been swapped under us.
        public string? ContentSha256 { get; set; }

        // ok | no-format | rules-empty | unreadable | error
        // Mirrors the response branches in POImportController.RouteParseAsync.
        public string ParseOutcome { get; set; } = "";

        // Which format actually matched (null when no-format / unreadable / error).
        public int? MatchedFormatId { get; set; }
        public int? MatchedFormatVersion { get; set; }

        public int ItemsExtracted { get; set; }
        public int ParseDurationMs { get; set; }

        // Exception text when ParseOutcome == "error". Trimmed to 1000 chars.
        public string? ErrorMessage { get; set; }

        // Free-form admin annotation — used when triaging a failing PDF.
        public string? Notes { get; set; }
    }
}
