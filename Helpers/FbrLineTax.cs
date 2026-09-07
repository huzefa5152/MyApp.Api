using MyApp.Api.Models;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Per-line sales tax, further tax and notified retail price — the ONE place
    /// these three are worked out.
    ///
    /// Lifted out of <c>FbrService</c> (2026-09-03) unchanged, so the Sales
    /// Detail report can state the same figures the FBR payload carries. A
    /// report must never grow its own accounting calculation, and "line x rate"
    /// is wrong in three specific ways that this encodes:
    ///
    ///  (1) 3rd Schedule Goods (SN008, SN027)
    ///      salesTax = retailPrice x rate. PRAL's sandbox rejects the
    ///      backed-out (tax-inclusive) formula with [0102], even though some
    ///      earlier docs described it the other way round.
    ///
    ///  (2) Standard rate + Unregistered buyer (SN002)
    ///      furtherTax = lineTotal x 4%. Skipping it triggers FBR [0102].
    ///
    ///  (3) End-consumer retail (SN026, SN027, SN028)
    ///      furtherTax = 0 even though the buyer is Unregistered — exempting
    ///      that is the whole point of the SN026/27/28 scenario family.
    ///
    /// Pure and static on purpose: no dependency to inject, so a report can call
    /// it without taking FbrService along.
    /// </summary>
    public static class FbrLineTax
    {
        /// <summary>
        /// Returns (salesTax, furtherTax, fixedNotifiedValueOrRetailPrice) for
        /// one invoice line. Every caller needs all three.
        /// </summary>
        /// <param name="documentFurtherTaxRate">
        /// The rate stored on the document, when the operator set one. It WINS over
        /// the statutory 4% below (2026-09-07 decision), so the printed invoice and
        /// the FBR filing always carry the same figure -- a document showing 3% and
        /// filing 4% is the worse outcome. Null leaves the original behaviour:
        /// derive it from the buyer's registration and the sale type.
        /// </param>
        public static (decimal SalesTax, decimal FurtherTax, decimal RetailPrice) Compute(
            InvoiceItem item, decimal gstRate, string buyerRegType, string? scenarioId,
            decimal? documentFurtherTaxRate = null)
        {
            var rate = gstRate / 100m;
            var retail = item.FixedNotifiedValueOrRetailPrice ?? 0m;
            decimal salesTax;
            decimal furtherTax = 0m;

            var isThirdSchedule = string.Equals(
                item.SaleType, "3rd Schedule Goods", StringComparison.OrdinalIgnoreCase);
            var isStandardRate = string.Equals(
                item.SaleType, "Goods at Standard Rate (default)", StringComparison.OrdinalIgnoreCase)
                || string.Equals(
                    item.SaleType, "Goods at standard rate (default)", StringComparison.OrdinalIgnoreCase);

            // (1) 3rd Schedule: tax = MRP x rate (forward).
            if (isThirdSchedule && retail > 0m)
            {
                salesTax = Math.Round(retail * rate, 2, MidpointRounding.AwayFromZero);
            }
            else
            {
                salesTax = Math.Round(item.LineTotal * rate, 2, MidpointRounding.AwayFromZero);
            }

            // (2) Unregistered + standard-rate => 4% further tax
            // (3) …except SN026/027/028 end-consumer retail (exempt)
            var isEndConsumerRetail = scenarioId is "SN026" or "SN027" or "SN028";

            if (documentFurtherTaxRate is > 0m)
            {
                // The operator said what the rate is; the filing follows the
                // document. Charged on the line net, the same base as (2) below.
                furtherTax = Math.Round(
                    item.LineTotal * documentFurtherTaxRate.Value / 100m, 2, MidpointRounding.AwayFromZero);
            }
            else if (buyerRegType == "Unregistered" && isStandardRate && !isEndConsumerRetail)
            {
                furtherTax = Math.Round(item.LineTotal * 0.04m, 2, MidpointRounding.AwayFromZero);
            }

            return (salesTax, furtherTax, retail);
        }
    }
}
