using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// WHICH invoices a bulk operation is allowed to touch, decided by the
    /// endpoint and never by the request.
    ///
    /// There is no public constructor on purpose. A scope can only come from
    /// <see cref="ForUser"/> (an authenticated caller, after the company and
    /// division guards have run) or <see cref="ForPortal"/> (a resolved public
    /// portal token). That is the same reasoning <c>ResolvePortalAttribute</c>
    /// is a filter rather than a line in each action: the check has to be
    /// impossible to forget on the endpoint somebody adds next year.
    ///
    /// A caller-supplied clientId is a FILTER, carried in
    /// <see cref="InvoiceBulkRequestDto"/> and intersected with this; it can
    /// never widen the set. For a portal, <see cref="PortalClientId"/> pins the
    /// client outright, so a request naming another client cannot express
    /// anything — the parameter does not reach the query.
    /// </summary>
    public sealed class InvoiceBulkScope
    {
        /// <summary>The one company every invoice in the batch must belong to.</summary>
        public int CompanyId { get; }

        /// <summary>
        /// Set for a portal, null for an internal caller. When set, the query
        /// filters on it unconditionally and the request's own ClientId is
        /// ignored rather than merely validated — absent beats checked.
        /// </summary>
        public int? PortalClientId { get; }

        /// <summary>
        /// The divisions an internal caller may see, from
        /// <c>IDivisionAccessGuard.GetAccessibleDivisionIdsAsync</c>. Null means
        /// unrestricted (the guard reported no restriction); an EMPTY set means
        /// restricted to nothing and must return nothing — those two are not
        /// the same and conflating them turns the guard into a no-op.
        /// </summary>
        public IReadOnlyCollection<int>? AllowedDivisionIds { get; }

        public bool IsCustomerPortal => PortalClientId.HasValue;

        private InvoiceBulkScope(int companyId, int? portalClientId, IReadOnlyCollection<int>? allowedDivisionIds)
        {
            CompanyId = companyId;
            PortalClientId = portalClientId;
            AllowedDivisionIds = allowedDivisionIds;
        }

        /// <summary>
        /// An authenticated caller. The controller must already have asserted
        /// company access (<c>[AuthorizeCompany]</c> plus
        /// <c>ICompanyAccessGuard.AssertAccessAsync</c>) before calling this —
        /// this type records the decision, it does not make it.
        /// </summary>
        public static InvoiceBulkScope ForUser(int companyId, IReadOnlyCollection<int>? allowedDivisionIds) =>
            new(companyId, null, allowedDivisionIds);

        /// <summary>A resolved public portal: one company, one client, no division restriction.</summary>
        public static InvoiceBulkScope ForPortal(ResolvedPortal portal) =>
            new(portal.CompanyId, portal.ClientId, null);
    }

    /// <summary>
    /// The ONE place a bulk invoice batch is resolved, shared by the internal
    /// Invoices screen and the public Customer Portal.
    ///
    /// Rendering is deliberately NOT here. This solution has no server-side PDF
    /// writer (see <c>PublicCustomerPortalController</c>) — a printed document
    /// is produced by merging the template in the browser and rasterising it,
    /// and every print, PDF and Excel path already goes through that one
    /// renderer. So the split is:
    ///
    ///     server  →  authorization, selection, template resolution, naming
    ///     browser →  merge, render, PDF, ZIP, consolidated document
    ///
    /// Both surfaces call this service and then hand its result to the same
    /// browser module, so the PDF for one invoice on one template is identical
    /// whichever endpoint asked for it.
    ///
    /// PORTING NOTE. This feature is written to be cherry-picked onto
    /// <c>customize-solution-for-other</c>, which already has the Customer
    /// Portal, printLayout and ReportPeriod that it depends on (master has
    /// none of them, so it is not a port target).
    ///
    /// All of the logic lives in NEW files, because a new file cannot conflict:
    /// this interface, InvoiceBulkService, InvoiceBulkDtos, InvoiceBulkController,
    /// and on the frontend bulkInvoiceDocuments.js, pdfPageCuts.js and
    /// BulkInvoiceDialog.jsx. <c>InvoicesController</c> and <c>PrintDtos</c> are
    /// deliberately NOT touched — the internal endpoint has its own controller —
    /// because those diverge between the branches by ~157 and ~196 lines.
    ///
    /// Four of the edited files are byte-identical on both branches and will
    /// pick cleanly: PublicCustomerPortalController, portalApi.js,
    /// CustomerPortalsPage.jsx, package.json. The one place to EXPECT a conflict
    /// is <c>myapp-frontend/src/utils/exportUtils.js</c>: the branches differ
    /// inside <c>exportToPdf</c> (this branch has waitForImages and the
    /// orientation/side-margin options), and that is the function the render
    /// primitive was extracted out of. Port the extraction by hand there;
    /// everything else is additive.
    /// </summary>
    public interface IInvoiceBulkService
    {
        /// <summary>
        /// Resolve the batch. <paramref name="scope"/> comes first and has no
        /// default so a caller cannot omit it.
        /// </summary>
        Task<InvoiceBulkBatchDto> ResolveBatchAsync(InvoiceBulkScope scope, InvoiceBulkRequestDto request);
    }
}
