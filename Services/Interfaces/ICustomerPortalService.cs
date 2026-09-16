using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// A portal resolved from its public token. Everything the public endpoints
    /// are allowed to know about the caller, and the ONLY source of the company
    /// and client used to scope every downstream query. Nothing from the route,
    /// the query string or the body may ever override these two ids.
    /// </summary>
    public record ResolvedPortal(int PortalId, int CompanyId, int ClientId, string? DocumentType);

    /// <summary>
    /// Customer Portal: management for internal users, and the read-only public
    /// surface behind a token.
    ///
    /// The public half cannot use <see cref="ICompanyAccessGuard"/>. Every
    /// method there takes a userId, and the seed admin is granted everything
    /// unconditionally — so calling it from an anonymous request would mean
    /// inventing a user id, and whichever id was chosen would either fail for
    /// everyone or succeed for everything. NEVER SYNTHESISE A USER ID HERE.
    ///
    /// Tenant scope on this path is enforced by construction instead: every
    /// public method takes a <see cref="ResolvedPortal"/> rather than ids, and
    /// every query filters on BOTH its CompanyId and its ClientId.
    /// </summary>
    public interface ICustomerPortalService
    {
        // ── Management (authenticated, RBAC-gated) ───────────────────────────

        Task<List<CustomerPortalDto>> GetAllAsync(IReadOnlyCollection<int> allowedCompanyIds, Func<string, string> urlBuilder);
        Task<CustomerPortalDto?> GetByIdAsync(int id, Func<string, string> urlBuilder);

        /// <summary>Issues a portal. Throws when the client does not belong to
        /// the company, or when that pair already has an active portal — one
        /// live link per customer.</summary>
        Task<CustomerPortalDto> CreateAsync(int companyId, int clientId, string? documentType, int userId, Func<string, string> urlBuilder);

        /// <summary>Change which document an existing portal serves. The link is
        /// unaffected, so nothing has to be re-sent.</summary>
        Task<CustomerPortalDto?> SetDocumentTypeAsync(int id, string? documentType, int userId, Func<string, string> urlBuilder);

        /// <summary>Which invoice documents this company has templates for.</summary>
        Task<List<PortalDocumentOptionDto>> GetDocumentOptionsAsync(int companyId);

        /// <summary>Enable or disable. The same token comes back on re-enable.</summary>
        Task<CustomerPortalDto?> SetActiveAsync(int id, bool isActive, int userId, Func<string, string> urlBuilder);

        /// <summary>Revoke for good — the row goes and the token can never
        /// resolve again.</summary>
        Task<bool> DeleteAsync(int id);

        // ── Public (anonymous, token-scoped) ─────────────────────────────────

        /// <summary>Resolves an ACTIVE portal from its token, or null. Unknown,
        /// malformed, disabled and revoked tokens are indistinguishable to the
        /// caller by design.</summary>
        Task<ResolvedPortal?> ResolveAsync(string token);

        Task<PortalHeaderDto?> GetHeaderAsync(ResolvedPortal portal);

        Task<PagedResult<PortalInvoiceListItemDto>> GetInvoicesAsync(
            ResolvedPortal portal, int page, int pageSize,
            string? status, string? search, DateTime? dateFrom, DateTime? dateTo);

        /// <summary>One invoice, addressed by the NUMBER printed on the
        /// customer's copy and looked up inside the portal's scope. Null when it
        /// is not this portal's — another client's number simply does not exist
        /// from here.</summary>
        Task<PortalInvoiceDetailDto?> GetInvoiceAsync(ResolvedPortal portal, int invoiceNumber);

        /// <summary>Template and merge data for one invoice, resolved
        /// server-side so the template library is never published. Null when the
        /// invoice is not this portal's, or the company has no template.</summary>
        Task<PortalPrintPayloadDto?> GetPrintPayloadAsync(ResolvedPortal portal, int invoiceNumber);
    }
}
