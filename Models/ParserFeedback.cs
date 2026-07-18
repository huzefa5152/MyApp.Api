namespace MyApp.Api.Models
{
    /// <summary>
    /// A lightweight, self-contained record of how well the PO parser handled a
    /// single import — captured on the import Review screen so parser mistakes
    /// stop being invisible. The original uploaded PDF is retained on disk under
    /// <c>Data/uploads/parser_feedback/{YYYY}/{MM}/{guid}.pdf</c> so a developer
    /// can download it, reproduce the parse, and strengthen the parser.
    ///
    /// Deliberately decoupled from the rest of the PO import flow: nothing in
    /// importing reads this back, and the table is created idempotently in raw
    /// SQL (see <see cref="Data.ParserFeedbackSchema"/>) so the whole feature
    /// lives in isolated files and cherry-picks cleanly between branches.
    /// </summary>
    public class ParserFeedback
    {
        public int Id { get; set; }

        // The document created from this import (Sales Order / Quote / Challan,
        // depending on the branch's import targets). Nullable — feedback can be
        // recorded even if the create failed or the id wasn't captured.
        public int? PurchaseOrderId { get; set; }

        // Tenant context captured at record time. Not a FK — feedback outlives
        // the documents it references. Used only for optional filtering.
        public int? CompanyId { get; set; }

        // Original filename as the browser sent it — human triage aid.
        public string? OriginalFileName { get; set; }

        // Path relative to Data/uploads/parser_feedback — e.g. "2026/07/ab.pdf".
        // Null when the import came from pasted text (no PDF to retain).
        public string? OriginalPdfLocation { get; set; }

        public long FileSizeBytes { get; set; }

        // Which parser produced the extraction — the matched PO format name +
        // version (e.g. "Lotte Kolson PO (v3)"). Grouped in the statistics view
        // so accuracy can be tracked per parser version over time.
        public string? ParserVersion { get; set; }

        public ParserFeedbackStatus FeedbackStatus { get; set; }

        public string? CreatedBy { get; set; }

        public DateTime CreatedDate { get; set; } = DateTime.UtcNow;
    }
}
