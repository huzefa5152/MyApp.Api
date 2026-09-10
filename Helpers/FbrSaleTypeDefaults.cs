using MyApp.Api.Models;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// What a line files as when nobody chose a sale type for it.
    ///
    /// Why this exists (2026-09-10): the HS tariff import creates item types
    /// with no sale type, and an operator who adopts one and bills it never
    /// sees a field asking for one. Every real item on a live tenant's bills
    /// carried <c>SaleType = NULL</c>, so pre-flight refused every invoice
    /// with "Sale Type is required" and the edit form's scenario filter hid
    /// the bill's own item from its picker. A sale type is FBR metadata: the
    /// overwhelming default is the standard-rate supply, and a company that
    /// trades otherwise sets <see cref="Company.FbrDefaultSaleType"/>. So an
    /// empty sale type resolves to that default instead of blocking.
    ///
    /// The frontend mirrors this in <c>src/utils/saleType.js</c>; keep the
    /// two in step.
    /// </summary>
    public static class FbrSaleTypeDefaults
    {
        /// <summary>FBR's own string for the standard-rate supply, verbatim.</summary>
        public const string StandardRate = "Goods at Standard Rate (default)";

        /// <summary>The sale type an untyped line files as for this company.</summary>
        public static string ForCompany(Company? company)
            => string.IsNullOrWhiteSpace(company?.FbrDefaultSaleType)
                ? StandardRate
                : company!.FbrDefaultSaleType!.Trim();

        /// <summary>A stored sale type wins; an empty one becomes the company default.</summary>
        public static string Resolve(string? saleType, Company? company)
            => string.IsNullOrWhiteSpace(saleType) ? ForCompany(company) : saleType.Trim();
    }
}
