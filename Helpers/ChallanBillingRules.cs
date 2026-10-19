using MyApp.Api.Models;

namespace MyApp.Api.Helpers;

public static class ChallanBillingRules
{
    // This line bills Pending, Imported and No PO challans; Setup Required is never billable here.
    public static readonly string[] Statuses = { "Pending", "Imported", "No PO" };

    public static bool IsBillable(string status, int? invoiceId) =>
        invoiceId == null && Statuses.Contains(status);

    /// <summary>The status a challan returns to when it is not on a bill.</summary>
    public static string UnbilledStatus(DeliveryChallan dc) =>
        !string.IsNullOrWhiteSpace(dc.PoNumber) ? (dc.IsImported ? "Imported" : "Pending") : "No PO";

    /// <summary>
    /// A bill's lines and challans may change only before FBR submission has started:
    /// not cancelled, no IRN, never submitted, and a status a submit may still claim.
    /// </summary>
    public static bool BillEditable(Invoice bill) => !bill.IsCancelled
        && string.IsNullOrWhiteSpace(bill.FbrIRN) && bill.FbrSubmittedAt == null
        && (string.IsNullOrEmpty(bill.FbrStatus) || bill.FbrStatus == "Failed" || bill.FbrStatus == "Validated");
}
