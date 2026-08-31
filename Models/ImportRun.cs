namespace MyApp.Api.Models
{
    /// <summary>
    /// One committed spreadsheet import: who ran it, against which profile, from
    /// which file, and what it wrote.
    ///
    /// This is also the mechanism that stops the same file being imported twice.
    /// A duplicate import is not a harmless no-op — it doubles a customer's
    /// balance or an item's opening stock, and the damage is a plausible wrong
    /// number rather than a crash, so it can sit undetected for months. Two
    /// different duplicates need two different defences:
    ///
    ///   • SAME BYTES — caught by <see cref="FileSha256"/> under the filtered
    ///     unique index on (CompanyId, Kind, FileSha256). Enforced by the
    ///     DATABASE, not just service code, so two concurrent commits of one
    ///     file cannot both win.
    ///   • SAME DATA, DIFFERENT BYTES (a re-export, a resave) — the hash misses
    ///     it, so preview resolves every row's ExternalRef against what already
    ///     exists and refuses a run where nothing is new.
    ///
    /// Re-importing on purpose is allowed but explicit: an operator marks the
    /// prior run <see cref="IsSuperseded"/>, which drops it out of the filtered
    /// index while keeping it for audit.
    ///
    /// Runs cascade with their company: what a run records is what was written
    /// into that company, so it has no meaning once the company is gone.
    /// </summary>
    public class ImportRun
    {
        public int Id { get; set; }

        public int CompanyId { get; set; }
        public Company Company { get; set; } = null!;

        /// <summary>One of <see cref="ImportKinds"/>. Part of the dedupe key, so
        /// the same workbook can legitimately feed two different importers.</summary>
        public string Kind { get; set; } = "";

        /// <summary>Profile used, and the version of its mapping at the time.
        /// Nullable because a profile can be deleted later; the run must
        /// survive it.</summary>
        public int? ImportProfileId { get; set; }
        public int? ProfileVersion { get; set; }

        /// <summary>SHA-256 (hex, lower-case) of the uploaded bytes — same
        /// convention as <see cref="Attachment.ContentSha256"/> and
        /// <see cref="PoImportArchive.ContentSha256"/>.</summary>
        public string FileSha256 { get; set; } = "";

        public string OriginalFileName { get; set; } = "";
        public long FileSizeBytes { get; set; }

        /// <summary>Rows written, by target, as JSON — e.g.
        /// <c>{"clients":65,"invoices":598,"receipts":165}</c>. JSON so a new
        /// import kind adds its own counters without a migration.</summary>
        public string CountsJson { get; set; } = "{}";

        /// <summary>No FK: the run is an audit record and must outlive the user
        /// who made it, the same reasoning as <see cref="PoImportArchive"/>.</summary>
        public int ImportedByUserId { get; set; }

        public DateTime ImportedAt { get; set; } = DateTime.UtcNow;

        /// <summary>Set when an operator deliberately re-imported over this run.
        /// The row stops blocking new imports of the same file and stays for
        /// audit.</summary>
        public bool IsSuperseded { get; set; }

        public DateTime? SupersededAt { get; set; }
        public int? SupersededByUserId { get; set; }
        public string? SupersedeReason { get; set; }
    }
}
