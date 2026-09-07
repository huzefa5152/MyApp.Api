using Microsoft.EntityFrameworkCore;
using MyApp.Api.Models.Accounting;

namespace MyApp.Api.Data
{
    /// <summary>
    /// Idempotent runtime seeder for the "Further Tax Payable" control account.
    ///
    /// <see cref="Services.Implementations.CoaPresetSeeder"/> creates it for any
    /// company set up from now on, but a company whose chart of accounts already
    /// exists would never get it — and PostingService falls back to Suspense
    /// when a control account is missing, so every invoice carrying further tax
    /// would land in Suspense and be flagged by the Posting Exceptions report.
    /// This backfills it for the companies that already have a chart.
    ///
    /// Deliberately narrow: it adds ONE account, only to a company that already
    /// has a chart and no FurtherTaxPayable account. Re-running the whole preset
    /// would also resurrect accounts an operator had deliberately removed.
    /// Keyed on the same <c>seed:further_tax_payable</c> external ref the preset
    /// uses, so the two can never produce a duplicate.
    /// </summary>
    public static class FurtherTaxAccountSeeder
    {
        private const string Ref = "seed:further_tax_payable";

        public static async Task SeedAsync(AppDbContext db)
        {
            // Companies that have a chart at all, and no further-tax account.
            var companyIds = await db.Accounts
                .Select(a => a.CompanyId)
                .Distinct()
                .ToListAsync();
            if (companyIds.Count == 0) return;

            var haveIt = await db.Accounts
                .Where(a => a.ControlType == ControlType.FurtherTaxPayable
                         || a.ExternalRef == Ref)
                .Select(a => a.CompanyId)
                .Distinct()
                .ToListAsync();

            var missing = companyIds.Except(haveIt).ToList();
            if (missing.Count == 0) return;

            foreach (var companyId in missing)
            {
                // Put it beside Output Sales Tax, which is the group an operator
                // would look in. Falls back to any liability group, then to
                // nothing at all -- a company with no liability group is not one
                // this seeder should be inventing structure for.
                var groupId = await db.Accounts
                    .Where(a => a.CompanyId == companyId && a.ControlType == ControlType.OutputTax)
                    .Select(a => (int?)a.AccountGroupId)
                    .FirstOrDefaultAsync()
                    ?? await db.AccountGroups
                        .Where(g => g.CompanyId == companyId && g.ExternalRef == "seed:liabilities")
                        .Select(g => (int?)g.Id)
                        .FirstOrDefaultAsync();
                if (groupId is null) continue;

                var position = await db.Accounts
                    .Where(a => a.AccountGroupId == groupId.Value)
                    .MaxAsync(a => (int?)a.Position) ?? 0;

                db.Accounts.Add(new Account
                {
                    CompanyId = companyId,
                    Name = "Further Tax Payable",
                    AccountGroupId = groupId.Value,
                    AccountType = AccountType.Liability,
                    IsControlAccount = true,
                    ControlType = ControlType.FurtherTaxPayable,
                    IsActive = true,
                    Position = position + 1,
                    ExternalRef = Ref,
                });
            }

            await db.SaveChangesAsync();
        }
    }
}
