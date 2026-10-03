namespace MyApp.Api.Helpers;

public static class ChallanBillingRules
{
    public static readonly string[] Statuses = { "Pending", "Imported", "No PO", "Setup Required" };
    public static bool IsBillable(string status, int? invoiceId) =>
        invoiceId == null && Statuses.Contains(status);
}
