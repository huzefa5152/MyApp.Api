namespace MyApp.Api.Models
{
    /// <summary>
    /// A public, unauthenticated window onto ONE client's invoices.
    ///
    /// An internal user creates a portal for a (Company, Client) pair; the row's
    /// <see cref="PublicToken"/> becomes the whole of the URL's security. Anyone
    /// holding that URL sees that client's invoices and nothing else — the token
    /// is a bearer capability, so it is treated as a secret: never logged (see
    /// <see cref="Helpers.SensitiveDataRedactor"/>), never derived from ids, and
    /// generated with a CSPRNG.
    ///
    /// The company + client are resolved SERVER-SIDE from the token on every
    /// request. No client or company id from the query string, route or body is
    /// ever trusted — that is the single rule the whole feature rests on.
    ///
    /// Lifecycle: Active → Disabled (<see cref="IsActive"/> false, access stops
    /// at once, same token restored on re-enable) → Deleted (row removed, token
    /// dead for good). At most ONE ACTIVE portal exists per (Company, Client),
    /// enforced by a filtered unique index so a client never ends up with two
    /// live links in circulation.
    /// </summary>
    public class CustomerPortal
    {
        public int Id { get; set; }

        public int CompanyId { get; set; }
        public int ClientId { get; set; }

        /// <summary>
        /// The secret in the URL: 32 CSPRNG bytes, base64url-encoded to 43
        /// characters (see <see cref="Helpers.PublicTokenGenerator"/>). Stored in
        /// plaintext because the management screen must be able to re-display the
        /// link for "Copy URL" long after creation — a hash would make the link
        /// unrecoverable. Uniquely indexed; the column is the lookup key.
        /// </summary>
        public string PublicToken { get; set; } = "";

        /// <summary>
        /// False = disabled. The public endpoints refuse a disabled portal
        /// immediately, with the same "no longer available" response an unknown
        /// token gets, so a probe can't tell a disabled portal from a wrong guess.
        /// </summary>
        public bool IsActive { get; set; } = true;

        /// <summary>
        /// Which document the customer downloads: "Bill" or "TaxInvoice" — the
        /// two are different templates fed by different merge data, so the
        /// operator picks one when issuing the portal and it never changes on
        /// its own.
        ///
        /// NULL means "decide automatically" (Bill when the company has one,
        /// otherwise Tax Invoice). That is only for portals issued before this
        /// column existed: defaulting them to a concrete type would silently
        /// point a live link at a template the company may not have, and the
        /// customer would lose the download with no warning.
        /// </summary>
        public string? DocumentType { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public int? CreatedByUserId { get; set; }
        public DateTime? UpdatedAt { get; set; }
        public int? UpdatedByUserId { get; set; }
        /// <summary>When the portal was last switched off; cleared on re-enable.</summary>
        public DateTime? DisabledAt { get; set; }

        // Navigation. CreatedBy/UpdatedBy are plain columns rather than FKs —
        // they are provenance, and a deleted user must not drag a live portal
        // (or block the delete) along with them.
        public Company Company { get; set; } = null!;
        public Client Client { get; set; } = null!;
    }
}
