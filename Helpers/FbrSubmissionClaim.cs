using MyApp.Api.Models;

namespace MyApp.Api.Helpers;

public static class FbrSubmissionClaim
{
    // The atomic claim must still describe the payload built from this snapshot.
    public static IQueryable<Invoice> Eligible(IQueryable<Invoice> invoices, Invoice snapshot)
    {
        var ids = snapshot.Items.Select(i => i.Id).ToList();
        var filing = snapshot.TaxFilingRowsJson;
        return invoices.Where(i => i.Id == snapshot.Id && i.FbrIRN == null && !i.IsCancelled
            && i.FbrReviewRequiredAt == null && i.TaxFilingRowsJson == filing
            && i.Items.Count == ids.Count && !i.Items.Any(line => !ids.Contains(line.Id))
            && (i.FbrStatus == null || i.FbrStatus == FbrSubmissionStatus.Failed || i.FbrStatus == FbrSubmissionStatus.Validated));
    }
}
