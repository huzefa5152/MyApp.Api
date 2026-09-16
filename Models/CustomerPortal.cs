namespace MyApp.Api.Models
{
    /// <summary>
    /// A public, unauthenticated window onto ONE client's invoices.
    ///
    /// An internal user issues a portal for a (Company, Client) pair; the row's
    /// <see cref="PublicToken"/> becomes the whole of the URL's security. Anyone
    /// holding that URL sees that client's invoices and nothing else, so the
    /// token is treated as a secret: generated with a CSPRNG, never derived from
    /// ids, never logged (see <see cref="Helpers.PortalTokenLogMasker"/> for the
    /// path and <see cref="Helpers.SensitiveDataRedactor"/> for bodies).
    ///
    /// The company and the client are resolved SERVER-SIDE from the token on
    /// every request. No client or company id from the route, query string or
    /// body is ever trusted — that is the single rule the whole feature rests
    /// on, and the reason the public service takes a resolved portal rather than
    /// ids.
    ///
    /// Lifecycle: Active → Disabled (<see cref="IsActive"/> false; access stops
    /// at once and the same token comes back on re-enable) → Revoked (the row
    /// goes and the token can never resolve again). At most ONE ACTIVE portal
    /// exists per (Company, Client), enforced by a filtered unique index, so a
    /// client never ends up with two live links in circulation.
    /// </summary>
    public class CustomerPortal
    {
        public int Id { get; set; }

        public int CompanyId { get; set; }
        public int ClientId { get; set; }

        /// <summary>
        /// The secret in the URL: 32 CSPRNG bytes, base64url-encoded to 43
        /// characters (<see cref="Helpers.PublicTokenGenerator"/>). Stored in
        /// plaintext because the management screen has to re-display the link
        /// for "Copy URL" long after it was issued — a hash would make the link
        /// unrecoverable and every reissue a new link to chase. Uniquely
        /// indexed; the column is the lookup key.
        /// </summary>
        public string PublicToken { get; set; } = "";

        /// <summary>
        /// False = disabled. The public endpoints refuse a disabled portal
        /// immediately, with the SAME response an unknown token gets, so a probe
        /// cannot tell a disabled portal from a wrong guess.
        /// </summary>
        public bool IsActive { get; set; } = true;

        /// <summary>
        /// Which document the customer downloads: "Bill" or "TaxInvoice". The
        /// two are different templates fed by different merge data, so the
        /// operator picks one when the link is issued.
        ///
        /// NULL means "decide automatically" — Bill when the company has one,
        /// otherwise Tax Invoice.
        /// </summary>
        public string? DocumentType { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public int? CreatedByUserId { get; set; }
        public DateTime? UpdatedAt { get; set; }
        public int? UpdatedByUserId { get; set; }

        /// <summary>When the portal was last switched off; cleared on re-enable.</summary>
        public DateTime? DisabledAt { get; set; }

        // Navigation. CreatedBy/UpdatedBy are plain columns rather than FKs —
        // they are provenance, and deleting a user must neither drag a live
        // portal along with them nor be blocked by one.
        public Company Company { get; set; } = null!;
        public Client Client { get; set; } = null!;
    }
}
