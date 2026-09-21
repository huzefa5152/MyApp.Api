using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class PrivateCompanyPOFormats : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_POFormats_CompanyId_ClientId",
                table: "POFormats");

            // A legacy global format may be assigned only to the company of
            // its actual ClientId. Group membership does not prove ownership.
            // Ambiguous rows and older duplicates are retained but quarantined.
            migrationBuilder.Sql("""
                UPDATE f SET CompanyId = c.CompanyId
                FROM POFormats f JOIN Clients c ON c.Id = f.ClientId
                WHERE f.CompanyId IS NULL;

                UPDATE f SET CompanyId = NULL
                FROM POFormats f LEFT JOIN Clients c ON c.Id = f.ClientId
                WHERE c.Id IS NULL OR c.CompanyId <> f.CompanyId;

                WITH ranked AS (
                    SELECT Id, ROW_NUMBER() OVER (
                        PARTITION BY CompanyId, ClientId
                        ORDER BY IsActive DESC, UpdatedAt DESC, Id DESC) AS rn
                    FROM POFormats WHERE CompanyId IS NOT NULL AND ClientId IS NOT NULL
                )
                UPDATE f SET CompanyId = NULL
                FROM POFormats f JOIN ranked r ON r.Id = f.Id WHERE r.rn > 1;
                """);

            migrationBuilder.CreateIndex(
                name: "IX_POFormats_CompanyId_ClientId",
                table: "POFormats",
                columns: new[] { "CompanyId", "ClientId" },
                unique: true,
                filter: "[CompanyId] IS NOT NULL AND [ClientId] IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            throw new NotSupportedException("Private PO format ownership cannot be reverted safely. Restore the pre-upgrade database backup to roll back.");
        }
    }
}
