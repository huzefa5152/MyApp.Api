namespace MyApp.Api.DTOs
{
    // ── Import profiles ──────────────────────────────────────────────────────

    /// <summary>A saved workbook layout, as the profile list and editor see it.</summary>
    public class ImportProfileDto
    {
        public int Id { get; set; }
        public string Kind { get; set; } = "";
        public string Layout { get; set; } = "";
        public string Name { get; set; } = "";

        /// <summary>Null = installation-wide, usable by any company.</summary>
        public int? CompanyId { get; set; }
        public string? CompanyName { get; set; }

        /// <summary>True when <see cref="CompanyId"/> is null — the flag the UI
        /// reads, so it never has to infer meaning from a null.</summary>
        public bool IsShared { get; set; }

        public string SignatureHash { get; set; } = "";
        public string MappingJson { get; set; } = "{}";
        public int CurrentVersion { get; set; }
        public bool IsActive { get; set; }
        public string? Notes { get; set; }
        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }
    }

    public class CreateImportProfileDto
    {
        public string Kind { get; set; } = "";
        public string Layout { get; set; } = "";
        public string Name { get; set; } = "";

        /// <summary>Company the profile belongs to. Null asks for an
        /// installation-wide profile, which only the seed admin may create.</summary>
        public int? CompanyId { get; set; }

        /// <summary>From the identify step. A profile saved without one can
        /// never be auto-matched, so it is required.</summary>
        public string SignatureHash { get; set; } = "";
        public string TokenSignature { get; set; } = "";

        public string MappingJson { get; set; } = "{}";
        public string? Notes { get; set; }
    }

    /// <summary>
    /// Every field optional — an edit that only renames must not have to resend
    /// the mapping and risk clobbering it. A changed <see cref="MappingJson"/>
    /// or <see cref="Layout"/> bumps the version and writes history.
    /// </summary>
    public class UpdateImportProfileDto
    {
        public string? Name { get; set; }
        public string? Layout { get; set; }
        public string? MappingJson { get; set; }
        public string? SignatureHash { get; set; }
        public string? TokenSignature { get; set; }
        public bool? IsActive { get; set; }
        public string? Notes { get; set; }
        public string? ChangeNote { get; set; }
    }

    public class ImportProfileVersionDto
    {
        public int Id { get; set; }
        public int Version { get; set; }
        public string Layout { get; set; } = "";
        public string MappingJson { get; set; } = "{}";
        public string? ChangeNote { get; set; }
        public string? CreatedBy { get; set; }
        public DateTime CreatedAt { get; set; }
    }

    public class RollbackImportProfileDto
    {
        /// <summary>Version to restore. Copied forward as a NEW version rather
        /// than rewinding the counter, so history stays a straight line.</summary>
        public int Version { get; set; }
        public string? ChangeNote { get; set; }
    }

    // ── Identify ─────────────────────────────────────────────────────────────

    /// <summary>
    /// A worksheet as the mapping UI needs to render it: the name, how much data
    /// it holds, and a small grid of the top-left cells so the operator can see
    /// what they are mapping.
    /// </summary>
    public class WorkbookSheetPreviewDto
    {
        public int Index { get; set; }
        public string Name { get; set; } = "";
        public int LastRow { get; set; }

        /// <summary>Row-major sample of the top-left corner, capped by the
        /// identify service. Strings only — the mapping step cares about labels,
        /// not typed values.</summary>
        public List<List<string>> Rows { get; set; } = new();
    }

    /// <summary>A stored profile offered as a possible match for an upload.</summary>
    public class ImportProfileMatchDto
    {
        public int ProfileId { get; set; }
        public string Name { get; set; } = "";
        public string Layout { get; set; } = "";
        public bool IsShared { get; set; }

        /// <summary>1.0 for an exact signature-hash hit, otherwise the Jaccard
        /// overlap of the token signatures.</summary>
        public double Similarity { get; set; }

        /// <summary>True only for an exact hash match — the case the UI may skip
        /// straight past. A near match is always confirmed by a human.</summary>
        public bool IsExact { get; set; }
    }

    /// <summary>
    /// What the identify step returns: the validated file, whether this exact
    /// file has been imported before, which profile (if any) recognises it, and
    /// enough of the workbook to drive a mapping UI when none does.
    /// </summary>
    public class ImportIdentifyResultDto
    {
        public string FileName { get; set; } = "";
        public long FileSizeBytes { get; set; }

        /// <summary>SHA-256 of the uploaded bytes. Echoed back to preview and
        /// commit so those steps act on the file the operator actually reviewed.</summary>
        public string FileSha256 { get; set; } = "";

        public string Kind { get; set; } = "";
        public string SignatureHash { get; set; } = "";
        public string TokenSignature { get; set; } = "";

        /// <summary>Best exact match, when there is one.</summary>
        public ImportProfileMatchDto? MatchedProfile { get; set; }

        /// <summary>Near matches worth confirming, best first.</summary>
        public List<ImportProfileMatchDto> Candidates { get; set; } = new();

        /// <summary>Set when this exact file was already imported into this
        /// company for this kind. Non-null means commit will be refused.</summary>
        public ImportRunDto? AlreadyImported { get; set; }

        public List<WorkbookSheetPreviewDto> Sheets { get; set; } = new();

        /// <summary>Layouts the operator may choose for this kind when nothing
        /// matched.</summary>
        public List<string> AvailableLayouts { get; set; } = new();

        /// <summary>Blocking problems. Non-empty means don't continue.</summary>
        public List<string> Errors { get; set; } = new();

        /// <summary>Worth reading, but not blocking.</summary>
        public List<string> Warnings { get; set; } = new();
    }

    // ── Import runs ──────────────────────────────────────────────────────────

    public class ImportRunDto
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public string Kind { get; set; } = "";
        public int? ImportProfileId { get; set; }
        public string? ProfileName { get; set; }
        public int? ProfileVersion { get; set; }
        public string FileSha256 { get; set; } = "";
        public string OriginalFileName { get; set; } = "";
        public long FileSizeBytes { get; set; }

        /// <summary>Rows written per target, decoded from the stored JSON.</summary>
        public Dictionary<string, int> Counts { get; set; } = new();

        public int ImportedByUserId { get; set; }
        public string? ImportedByUserName { get; set; }
        public DateTime ImportedAt { get; set; }

        public bool IsSuperseded { get; set; }
        public DateTime? SupersededAt { get; set; }
        public string? SupersedeReason { get; set; }
    }

    public class SupersedeImportRunDto
    {
        /// <summary>Why the earlier import is being set aside. Required — this
        /// is the one action that lets imported history be overwritten, so it
        /// does not happen without a reason on the record.</summary>
        public string Reason { get; set; } = "";
    }
}
