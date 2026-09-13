using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <summary>
    /// Data-only. Moves the legacy "Advance from Customers" control account off
    /// ControlType 19, which it shared with FurtherTaxPayable as a C# enum ALIAS.
    ///
    /// The alias was not cosmetic. On a chart carrying the legacy account,
    /// <c>PostingService.ResolveAsync(ControlType.FurtherTaxPayable)</c> could
    /// resolve to it and credit further tax (s.3(1A), owed to FBR) to a customer
    /// advances liability — the entry balances and the balance sheet is wrong,
    /// the worst shape a bug takes here. And <c>FurtherTaxAccountSeeder</c> read
    /// the same row as proof the company already had a further-tax account, so a
    /// chart with the legacy row was never given the real one.
    ///
    /// Keyed on the seeder's own stable ExternalRef, never on the name: an
    /// operator may have renamed the account, and no operator can have CREATED
    /// one at 19 (the Chart of Accounts picker only ever offered ControlType
    /// 0-13). Both writers of a 19 row therefore carry a seed ref, and only one
    /// of the two refs is ambiguous away.
    ///
    /// After this runs, FurtherTaxAccountSeeder (startup, idempotent) creates the
    /// Further Tax Payable account on the charts that were being skipped. Journal
    /// lines already posted to the legacy account keep pointing at it — a line
    /// references an account by id — so a company that filed further tax while
    /// this was wrong has to rebuild its ledger (Accounting -> rebuild) to move
    /// those amounts onto the correct account.
    /// </summary>
    public partial class SplitCustomerAdvancesControlType : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                UPDATE Accounts
                SET ControlType = 22
                WHERE ControlType = 19
                  AND ExternalRef = 'seed:customer_advances';
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                UPDATE Accounts
                SET ControlType = 19
                WHERE ControlType = 22
                  AND ExternalRef = 'seed:customer_advances';
            ");
        }
    }
}
