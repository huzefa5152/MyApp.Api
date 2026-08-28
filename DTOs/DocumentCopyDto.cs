namespace MyApp.Api.DTOs
{
    /// <summary>
    /// Wire shapes for the Copy Document feature — one generic endpoint pair
    /// serving all six copyable document types. The vocabulary and the
    /// source→destination matrix live in
    /// <see cref="MyApp.Api.Helpers.DocumentCopyTypes"/>.
    /// </summary>
    public class CopyDocumentRequestDto
    {
        public string SourceType { get; set; } = "";
        public int SourceId { get; set; }
        /// <summary>Destination type; equal to <see cref="SourceType"/> for a same-document copy.</summary>
        public string DestinationType { get; set; } = "";

        public bool CopyLineItems { get; set; } = true;
        public bool CopyDocumentDetails { get; set; } = true;
        public bool CopyAttachments { get; set; }

        /// <summary>
        /// Optional date for the new document. Null = today, which is the
        /// behaviour the copy dialog relies on; a copy never inherits the
        /// source's date (that is a regenerated field).
        /// </summary>
        public DateTime? Date { get; set; }
    }

    /// <summary>What a copy produced — enough for the UI to navigate to it and report.</summary>
    public class CopyDocumentResultDto
    {
        public string DocumentType { get; set; } = "";
        /// <summary>UI label for <see cref="DocumentType"/>, e.g. "Sales Order".</summary>
        public string DocumentTypeLabel { get; set; } = "";
        public int Id { get; set; }
        /// <summary>The newly allocated document number (never the source's).</summary>
        public int Number { get; set; }

        public string SourceType { get; set; } = "";
        public int SourceId { get; set; }
        public int SourceNumber { get; set; }

        public int LineItemsCopied { get; set; }
        public int AttachmentsCopied { get; set; }

        /// <summary>
        /// Operator-facing notes about anything the copy deliberately dropped or
        /// changed (a supplier IRN not carried over, a fractional quantity
        /// rounded for a goods receipt, an unavailable line photo).
        /// </summary>
        public List<string> Warnings { get; set; } = new();
    }

    /// <summary>The copy dialog's menu for one source document.</summary>
    public class CopyTargetsDto
    {
        public string SourceType { get; set; } = "";
        public string SourceTypeLabel { get; set; } = "";
        public int SourceId { get; set; }
        public int SourceNumber { get; set; }
        public int CompanyId { get; set; }
        public int? DivisionId { get; set; }
        /// <summary>Attachments currently on the source — 0 hides the attachments option.</summary>
        public int AttachmentCount { get; set; }
        public List<CopyTargetDto> Targets { get; set; } = new();
    }

    public class CopyTargetDto
    {
        public string Type { get; set; } = "";
        public string Label { get; set; } = "";
        /// <summary>True when this is a copy of the source into its own type.</summary>
        public bool IsSameDocument { get; set; }
        /// <summary>False when the caller lacks the destination's create permission.</summary>
        public bool Allowed { get; set; }
        /// <summary>Why the destination is unavailable, when <see cref="Allowed"/> is false.</summary>
        public string? Reason { get; set; }
        /// <summary>
        /// Set when the destination ignores the line-item / detail toggles because
        /// it delegates to an existing conversion flow with fixed semantics.
        /// The dialog disables those checkboxes and shows this note.
        /// </summary>
        public string? FixedBehaviourNote { get; set; }
    }
}
