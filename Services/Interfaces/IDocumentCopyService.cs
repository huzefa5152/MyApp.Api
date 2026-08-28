using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// Identity of a copy source, resolved before any work happens so the
    /// controller can run the tenant / division / permission gates against real
    /// values rather than trusting the request body.
    /// </summary>
    public record DocumentCopySourceRef(string Type, int Id, int CompanyId, int? DivisionId, int Number);

    /// <summary>
    /// The single entry point for the Copy Document feature. It owns the
    /// source→destination field mapping and nothing else: numbering, totals,
    /// stock, GL posting and validation all stay with each document's own
    /// service, which this one calls. That is deliberate — a copy must be
    /// indistinguishable from a document the operator typed by hand.
    /// </summary>
    public interface IDocumentCopyService
    {
        /// <summary>Company / division / number of a source, or null when it doesn't exist.</summary>
        Task<DocumentCopySourceRef?> GetSourceRefAsync(string sourceType, int sourceId);

        /// <summary>How many attachments sit on the source (drives the dialog's option).</summary>
        Task<int> GetAttachmentCountAsync(int companyId, string sourceType, int sourceId);

        /// <summary>
        /// Copies the source into a new document of the requested type. Throws
        /// <see cref="KeyNotFoundException"/> for a missing source and
        /// <see cref="InvalidOperationException"/> for an unsupported pair or a
        /// business rule that blocks the copy.
        /// </summary>
        Task<CopyDocumentResultDto> CopyAsync(CopyDocumentRequestDto request, int userId);
    }
}
