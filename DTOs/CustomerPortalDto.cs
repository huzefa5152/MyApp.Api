namespace MyApp.Api.DTOs
{
    /// <summary>
    /// Management-side view of a portal. Carries the live
    /// <see cref="PublicUrl"/> because the whole point of the screen is to hand
    /// that link to an operator — which also means this DTO holds a bearer
    /// secret and must never be logged, audited, or returned from anything but
    /// the permission-gated management endpoints.
    /// </summary>
    public class CustomerPortalDto
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public string CompanyName { get; set; } = "";
        public int ClientId { get; set; }
        public string ClientName { get; set; } = "";

        /// <summary>The full link to give the customer, built server-side.</summary>
        public string PublicUrl { get; set; } = "";

        public bool IsActive { get; set; }

        /// <summary>"Bill" | "TaxInvoice" | null (choose automatically).</summary>
        public string? DocumentType { get; set; }
        /// <summary>Friendly name for the row: "Bill", "Tax Invoice", or "Automatic".</summary>
        public string DocumentTypeLabel { get; set; } = "";
        /// <summary>
        /// False when the chosen document has no template on this company — the
        /// customer sees no Print or Download, so the management row can warn.
        /// </summary>
        public bool TemplateAvailable { get; set; }
        /// <summary>
        /// Which document types this company actually has templates for, so the
        /// management row can offer a switch without also offering a dead option.
        /// </summary>
        public List<string> AvailableDocumentTypes { get; set; } = new();

        public DateTime CreatedAt { get; set; }
        public DateTime? DisabledAt { get; set; }
    }

    /// <summary>Which invoice documents a company can actually produce.</summary>
    public class PortalDocumentOptionDto
    {
        public string Type { get; set; } = "";
        public string Label { get; set; } = "";
        /// <summary>False when the company has no template of this type yet.</summary>
        public bool Available { get; set; }
    }

    public class CreateCustomerPortalDto
    {
        public int CompanyId { get; set; }
        public int ClientId { get; set; }
        /// <summary>
        /// "Bill" or "TaxInvoice" — which document the customer downloads.
        /// Null lets the server choose (Bill if the company has one, else Tax
        /// Invoice), which is what portals created before this field did.
        /// </summary>
        public string? DocumentType { get; set; }
    }

    /// <summary>Body for changing which document an existing portal serves.</summary>
    public class SetPortalDocumentTypeDto
    {
        public string? DocumentType { get; set; }
    }

    /// <summary>Body for the enable/disable toggle.</summary>
    public class SetCustomerPortalActiveDto
    {
        public bool IsActive { get; set; }
    }
}
