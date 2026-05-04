using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class DropLegacyUniqueChallanNumberIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // The DB has a UNIQUE index on (CompanyId, ChallanNumber) that
            // was created out-of-band — it lives in production but isn't in
            // any source-tracked migration or in OnModelCreating. The
            // "Duplicate Challan" feature requires multiple rows sharing a
            // ChallanNumber, so we drop that legacy unique index here.
            //
            // Idempotent: only drops if it actually exists, so this migration
            // is safe on fresh DBs (e.g. dev environments built from
            // migrations alone, where the unique index never existed).
            migrationBuilder.Sql(@"
                IF EXISTS (
                    SELECT 1 FROM sys.indexes
                    WHERE name = 'IX_DeliveryChallans_CompanyId_ChallanNumber'
                      AND object_id = OBJECT_ID('dbo.DeliveryChallans')
                )
                BEGIN
                    DROP INDEX [IX_DeliveryChallans_CompanyId_ChallanNumber] ON [dbo].[DeliveryChallans];
                END
            ");

            // Recreate as a NON-UNIQUE composite index — keeps list queries
            // that filter/order by (CompanyId, ChallanNumber) fast (paged
            // list, MAX(ChallanNumber) for next-number, search-by-number),
            // without enforcing uniqueness at the DB level.
            migrationBuilder.CreateIndex(
                name: "IX_DeliveryChallans_CompanyId_ChallanNumber",
                table: "DeliveryChallans",
                columns: new[] { "CompanyId", "ChallanNumber" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Down only drops the non-unique replacement. We deliberately do
            // NOT recreate the legacy unique index — it was never in source,
            // and re-introducing uniqueness would break any duplicate rows
            // already created by users.
            migrationBuilder.DropIndex(
                name: "IX_DeliveryChallans_CompanyId_ChallanNumber",
                table: "DeliveryChallans");
        }
    }
}
