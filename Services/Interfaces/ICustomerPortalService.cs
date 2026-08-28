using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// A portal resolved from its public token. Everything the public endpoints
    /// are allowed to know about the caller — and the ONLY source of the company
    /// and client used to scope every downstream query. Nothing from the route,
    /// query string or body may ever override these two ids.
    /// </summary>
    public record ResolvedPortal(int PortalId, int CompanyId, int ClientId, string? DocumentType);

    /// <summary>
    /// Customer Portal: management for internal users, and the read-only public
    /// surface behind a token.
    ///
    /// The public half cannot use <c>ICompanyAccessGuard</c> — every method there
    /// takes a userId and returns true unconditionally for the seed admin — so
    /// tenant scope on this path is enforced by construction instead: each query
    /// filters on BOTH <see cref="ResolvedPortal.CompanyId"/> and
    /// <see cref="ResolvedPortal.ClientId"/>, and no method accepts a company or
    /// client id from the caller.
    /// </summary>
    public interface ICustomerPortalService
    {
        // ── Management (authenticated, RBAC-gated) ───────────────────────────

        Task<List<CustomerPortalDto>> GetAllAsync(IReadOnlyCollection<int> allowedCompanyIds, Func<string, string> urlBuilder);
        Task<CustomerPortalDto?> GetByIdAsync(int id, Func<string, string> urlBuilder);
        /// <summary>
        /// Issues a portal. Throws <see cref="InvalidOperationException"/> when the
        /// client does not belong to the company, or when that pair already has an
        /// active portal (one live link per customer).
        /// </summary>
        Task<CustomerPortalDto> CreateAsync(int companyId, int clientId, string? documentType, int userId, Func<string, string> urlBuilder);
        /// <summary>Change which document an existing portal serves. The link is unaffected.</summary>
        Task<CustomerPortalDto?> SetDocumentTypeAsync(int id, string? documentType, int userId, Func<string, string> urlBuilder);
        /// <summary>Which invoice documents this company has templates for.</summary>
        Task<List<PortalDocumentOptionDto>> GetDocumentOptionsAsync(int companyId);
        /// <summary>Enable/disable. The same token is restored on re-enable.</summary>
        Task<CustomerPortalDto?> SetActiveAsync(int id, bool isActive, int userId, Func<string, string> urlBuilder);
        /// <summary>Revoke for good — the row goes and the token can never resolve again.</summary>
        Task<bool> DeleteAsync(int id);

        // ── Public (anonymous, token-scoped) ─────────────────────────────────

        /// <summary>
        /// Resolves an ACTIVE portal from its token, or null. Disabled, revoked and
        /// unknown tokens are indistinguishable to the caller by design.
        /// </summary>
        Task<ResolvedPortal?> ResolveAsync(string token);

        Task<PortalHeaderDto?> GetHeaderAsync(ResolvedPortal portal);

        Task<PagedResult<PortalInvoiceListItemDto>> GetInvoicesAsync(
            ResolvedPortal portal, int page, int pageSize,
            string? status, string? search, DateTime? dateFrom, DateTime? dateTo);

        Task<PortalInvoiceDetailDto?> GetInvoiceAsync(ResolvedPortal portal, int invoiceNumber);

        /// <summary>
        /// Template + merge data for one invoice, resolved server-side so the
        /// template library is never published. Null when the invoice is not this
        /// portal's, or no template is configured for the company.
        /// </summary>
        Task<PortalPrintPayloadDto?> GetPrintPayloadAsync(ResolvedPortal portal, int invoiceNumber);
    }
}
