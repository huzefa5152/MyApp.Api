using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddBankReconciledDate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Idempotent + lineage-safe (branch-DB rule): the bank-recon columns
            // may already exist on this branch DB from an earlier experiment, so
            // guard each ADD instead of a bare AddColumn (which 2705s on a dup).
            migrationBuilder.Sql(
                "IF COL_LENGTH('Payments', 'ReconciledDate') IS NULL " +
                "ALTER TABLE [Payments] ADD [ReconciledDate] datetime2 NULL;");
            migrationBuilder.Sql(
                "IF COL_LENGTH('AccountTransfers', 'ReconciledDate') IS NULL " +
                "ALTER TABLE [AccountTransfers] ADD [ReconciledDate] datetime2 NULL;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                "IF COL_LENGTH('Payments', 'ReconciledDate') IS NOT NULL " +
                "ALTER TABLE [Payments] DROP COLUMN [ReconciledDate];");
            migrationBuilder.Sql(
                "IF COL_LENGTH('AccountTransfers', 'ReconciledDate') IS NOT NULL " +
                "ALTER TABLE [AccountTransfers] DROP COLUMN [ReconciledDate];");
        }
    }
}
