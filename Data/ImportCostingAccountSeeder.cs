using Microsoft.EntityFrameworkCore;
using MyApp.Api.Models.Accounting;

namespace MyApp.Api.Data
{
    /// <summary>
    /// Idempotent runtime seeder for the two GD-import-costing control
    /// accounts — "Import Clearing" (liability) and "Advance Income Tax on
    /// Imports" (asset).
    ///
    /// <see cref="Services.Implementations.CoaPresetSeeder"/> creates both for
    /// any company set up from now on, but a company whose chart of accounts
    /// already exists would never get them — and PostingService falls back to
    /// Suspense when a control account is missing, so every GD posted in New
    /// Arrivals mode would land there until this backfill runs. Mirrors
    /// <see cref="FurtherTaxAccountSeeder"/> exactly, for the same reason.
    ///
    /// Deliberately narrow: each account is added only to a company that
    /// already has a chart and lacks it. Re-running the whole preset would
    /// also resurrect accounts an operator had deliberately removed. Keyed on
    /// its own <c>seed:</c> external ref, so it can never collide with the
    /// preset or duplicate on a re-run.
    /// </summary>
    public static class ImportCostingAccountSeeder
    {
        private const string ImportClearingRef = "seed:import_clearing";
        private const string AdvanceIncomeTaxRef = "seed:advance_income_tax_imports";

        public static async Task SeedAsync(AppDbContext db)
        {
            // Beside Accounts Payable, falling back to the liabilities group —
            // the import liability reads exactly like a payable, and that is
            // where an operator would look for it.
            await SeedOneAsync(db, ImportClearingRef, ControlType.ImportClearing,
                "Import Clearing", AccountType.Liability,
                siblingControl: ControlType.AccountsPayable, fallbackGroupRef: "seed:liabilities");

            // Beside the existing withholding receivable, falling back to the
            // assets group — same "collected now, set off later" shape.
            await SeedOneAsync(db, AdvanceIncomeTaxRef, ControlType.AdvanceIncomeTaxOnImports,
                "Advance Income Tax on Imports", AccountType.Asset,
                siblingControl: ControlType.WithholdingReceivable, fallbackGroupRef: "seed:assets");
        }

        private static async Task SeedOneAsync(AppDbContext db, string externalRef, ControlType control,
            string name, AccountType accountType, ControlType siblingControl, string fallbackGroupRef)
        {
            // Companies that have a chart at all, and no account under this role.
            var companyIds = await db.Accounts
                .Select(a => a.CompanyId)
                .Distinct()
                .ToListAsync();
            if (companyIds.Count == 0) return;

            var haveIt = await db.Accounts
                .Where(a => a.ControlType == control || a.ExternalRef == externalRef)
                .Select(a => a.CompanyId)
                .Distinct()
                .ToListAsync();

            var missing = companyIds.Except(haveIt).ToList();
            if (missing.Count == 0) return;

            foreach (var companyId in missing)
            {
                // Put it beside its sibling role account, which is the group an
                // operator would look in. Falls back to the statement group the
                // preset seeds, then to nothing at all — a company with no such
                // group is not one this seeder should be inventing structure for.
                var groupId = await db.Accounts
                    .Where(a => a.CompanyId == companyId && a.ControlType == siblingControl)
                    .Select(a => (int?)a.AccountGroupId)
                    .FirstOrDefaultAsync()
                    ?? await db.AccountGroups
                        .Where(g => g.CompanyId == companyId && g.ExternalRef == fallbackGroupRef)
                        .Select(g => (int?)g.Id)
                        .FirstOrDefaultAsync();
                if (groupId is null) continue;

                var position = await db.Accounts
                    .Where(a => a.AccountGroupId == groupId.Value)
                    .MaxAsync(a => (int?)a.Position) ?? 0;

                db.Accounts.Add(new Account
                {
                    CompanyId = companyId,
                    Name = name,
                    AccountGroupId = groupId.Value,
                    AccountType = accountType,
                    IsControlAccount = true,
                    ControlType = control,
                    IsActive = true,
                    Position = position + 1,
                    ExternalRef = externalRef,
                });
            }

            await db.SaveChangesAsync();
        }
    }
}
