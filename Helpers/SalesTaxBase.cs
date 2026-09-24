using System.Text.RegularExpressions;
using MyApp.Api.Models;
using MyApp.Api.Services.Tax;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// What a bill's sales tax is charged ON -- the one rule for every path that
    /// works out an invoice's GSTAmount: both creates, the full and the narrow
    /// edit, a partial note, a challan re-sync and the tax-invoice print.
    ///
    /// 3rd Schedule goods are taxed on their printed retail price, MRP x Qty
    /// (<see cref="InvoiceItem.FixedNotifiedValueOrRetailPrice"/>), not on the
    /// value they are sold at -- the same test <see cref="FbrLineTax"/> applies to
    /// the FBR payload, so the bill charges the buyer what FBR is told. Before
    /// this the bill charged 18% of the sale value while FBR was sent 18% of the
    /// retail price: 180 on the bill, 270 at FBR, on the same 10 units.
    ///
    /// Every other line -- and a 3rd Schedule line with no retail price recorded
    /// -- is taxed on its value, so the base of a bill without 3rd Schedule goods
    /// is its subtotal and it is taxed exactly as before.
    /// </summary>
    public static class SalesTaxBase
    {
        public const string ThirdScheduleSaleType = "3rd Schedule Goods";

        private static readonly Regex Marker = new(@"\[\s*(SN\d{3})\s*\]", RegexOptions.IgnoreCase | RegexOptions.Compiled);

        /// <summary>The bill's own scenario, from the "[SNxxx]" its payment terms carry.</summary>
        public static string? ScenarioFrom(string? paymentTerms)
        {
            if (string.IsNullOrEmpty(paymentTerms)) return null;
            var m = Marker.Match(paymentTerms);
            return m.Success ? m.Groups[1].Value.ToUpperInvariant() : null;
        }

        /// <summary>
        /// A line is 3rd Schedule when it says so, or when the bill's scenario is a
        /// 3rd Schedule one -- the scenario decides every line's sale type at
        /// filing (FbrService), and an edit can leave a line with the catalog's
        /// empty sale type.
        /// </summary>
        public static bool IsThirdSchedule(string? saleType, string? scenarioId) =>
            string.Equals(saleType?.Trim(), ThirdScheduleSaleType, StringComparison.OrdinalIgnoreCase)
            || TaxScenarios.Find(scenarioId)?.IsThirdSchedule == true;

        /// <summary>The value one line is taxed on.</summary>
        public static decimal Line(decimal value, decimal? retail, string? saleType, string? scenarioId) =>
            retail is > 0m && IsThirdSchedule(saleType, scenarioId) ? retail.Value : value;

        /// <summary>The value a set of bill lines is taxed on.</summary>
        public static decimal Of(IEnumerable<InvoiceItem> items, string? scenarioId) =>
            items.Sum(i => Line(i.LineTotal, i.FixedNotifiedValueOrRetailPrice, i.SaleType, scenarioId));

        /// <summary>
        /// MRP x Qty for a line whose quantity changed: the MRP per unit belongs
        /// to the goods, so the total moves with the quantity.
        /// </summary>
        public static decimal? Rescale(decimal? retail, decimal oldQuantity, decimal newQuantity) =>
            retail is > 0m && oldQuantity > 0m && newQuantity != oldQuantity
                ? Math.Round(retail.Value / oldQuantity * newQuantity, 2, MidpointRounding.AwayFromZero)
                : retail;
    }
}
