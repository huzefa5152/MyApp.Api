namespace MyApp.Api.DTOs
{
    /// <summary>
    /// Preview row returned from the Excel import parser. Holds the raw fields
    /// extracted from one uploaded historical challan, plus resolver hints
    /// (matched client id, etc.) and any parse warnings. The user can edit any
    /// field in this DTO on the review screen before committing to the DB.
    /// </summary>
    public class ChallanImportPreviewDto
    {
        public string FileName { get; set; } = "";

        // Original challan number read from the template-mapped cell
        // (falls back to filename "DC # NNNN" if the cell is blank).
        public int ChallanNumber { get; set; }

        // Resolved client id — null if no company client's name matched the
        // parsed client text. User must pick one on the review screen.
        public int? ClientId { get; set; }
        public string? ClientNameRaw { get; set; }  // what was read from the file
        public string? ClientNameMatched { get; set; } // what DB client was matched

        // Brand check — read from the {{companyBrandName}} cell in the file and
        // compared against the target company's brand/name. Populated so the UI
        // can show "File says 'X' but target is 'Y'" when they diverge.
        public string? CompanyBrandRaw { get; set; }
        public bool CompanyBrandMismatch { get; set; }

        // True if we couldn't find the target company's brand anywhere in the
        // uploaded file's header region — strong signal that this file was
        // produced for a different company. Blocks commit on the UI side,
        // same as AlreadyExists.
        public bool WrongCompany { get; set; }

        public string? PoNumber { get; set; }
        public DateTime? PoDate { get; set; }
        public DateTime? DeliveryDate { get; set; }
        public string? Site { get; set; }

        public List<ChallanImportItemDto> Items { get; set; } = new();

        // True if a challan with this (CompanyId, ChallanNumber) already
        // exists in the DB — the preview endpoint flags these so the UI can
        // block the row from being committed until the user edits the number.
        // Advisory only: commit-time validation is the authoritative gate.
        public bool AlreadyExists { get; set; }

        // Non-fatal issues the parser wants the user to see (e.g. "Client name
        // 'MEKO' matched multiple — please pick one", "Quantity column not found").
        public List<string> Warnings { get; set; } = new();
    }

    public class ChallanImportItemDto
    {
        public int? ItemTypeId { get; set; }
        public string? ItemTypeName { get; set; }  // raw text from file, for display/match
        public string Description { get; set; } = "";
        public int Quantity { get; set; }
        public string Unit { get; set; } = "";
    }

    /// <summary>
    /// Result of committing a single challan from the preview grid.
    /// One per input row so the UI can mark successes and failures independently.
    /// </summary>
    public class ChallanImportResultDto
    {
        public string FileName { get; set; } = "";
        public int ChallanNumber { get; set; }
        public bool Success { get; set; }
        public int? InsertedId { get; set; }
        public string? Error { get; set; }
    }
}
